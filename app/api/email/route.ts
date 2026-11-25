import nodemailer from "nodemailer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addEmailHistory,
  getEmailStore,
  newCampaignId,
  newHistoryEntry,
  saveEmailTemplate,
  wasRecentlySent,
} from "@/lib/email-store";

const templateSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  fromName: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(30_000),
  signature: z.string().max(5_000),
});

const recipientSchema = z.object({
  email: z.string().trim().email().max(254),
  businessName: z.string().trim().min(1).max(200),
  businessCategory: z.string().trim().max(120).default(""),
  businessPhone: z.string().trim().max(80).default(""),
  businessWebsite: z.string().trim().max(500).default(""),
  businessAddress: z.string().trim().max(500).default(""),
});

const sendSchema = z.object({
  action: z.literal("send"),
  template: templateSchema,
  recipients: z.array(recipientSchema).min(1).max(30),
  consentConfirmed: z.literal(true),
});

const templateSaveSchema = z.object({
  action: z.literal("save-template"),
  template: templateSchema,
});

const recentSendWindow = 7 * 24 * 60 * 60 * 1000;
const sendRateLimitMs = 60 * 1000;
const sendAttempts = new Map<string, number>();

export async function GET(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host") || "")) {
    return NextResponse.json(
      { ok: false, error: "E-posta geçmişi bu sürümde yalnızca yerel uygulamada kullanılabilir." },
      { status: 403 },
    );
  }
  try {
    const store = await getEmailStore();
    return NextResponse.json(
      {
        ok: true,
        smtpConfigured: isSmtpConfigured(),
        smtpFrom: process.env.SMTP_FROM?.trim() || "",
        templates: store.templates,
        history: store.history.slice(0, 500),
      },
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    console.error("Email store read failed:", error);
    return NextResponse.json(
      { ok: false, error: "E-posta şablonları/geçmişi okunamadı." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request) || !isLoopbackHost(request.headers.get("host") || "")) {
    return NextResponse.json({ ok: false, error: "İstek kaynağı doğrulanamadı." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Geçersiz JSON isteği." }, { status: 400 });
  }

  const parsedSave = templateSaveSchema.safeParse(payload);
  if (parsedSave.success) {
    try {
      const template = await saveEmailTemplate(parsedSave.data.template);
      return NextResponse.json({ ok: true, template });
    } catch (error) {
      console.error("Email template save failed:", error);
      return NextResponse.json(
        { ok: false, error: "Şablon kaydedilemedi." },
        { status: 500 },
      );
    }
  }

  const parsedSend = sendSchema.safeParse(payload);
  if (!parsedSend.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Gönderim bilgileri geçersiz. İzin onayını ve en fazla 30 geçerli alıcıyı kontrol et.",
        details: parsedSend.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  if (!isSmtpConfigured()) {
    return NextResponse.json(
      { ok: false, error: "SMTP yapılandırılmamış. .env.local içindeki SMTP ayarlarını kontrol et." },
      { status: 503 },
    );
  }

  const sourceKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const lastAttempt = sendAttempts.get(sourceKey) ?? 0;
  if (Date.now() - lastAttempt < sendRateLimitMs) {
    return NextResponse.json(
      { ok: false, error: "Toplu gönderim için 60 saniye bekle." },
      { status: 429 },
    );
  }

  const recipients = deduplicateRecipients(parsedSend.data.recipients);
  if (recipients.length > 30) {
    return NextResponse.json(
      { ok: false, error: "Tek bir gönderimde en fazla 30 farklı alıcı seçebilirsin." },
      { status: 400 },
    );
  }

  const configuredFrom = process.env.SMTP_FROM?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (
    !configuredFrom ||
    !z.string().email().safeParse(configuredFrom).success ||
    !smtpHost ||
    !smtpUser ||
    !smtpPass ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return NextResponse.json(
      { ok: false, error: "SMTP ayarları eksik veya geçersiz." },
      { status: 503 },
    );
  }

  sendAttempts.set(sourceKey, Date.now());
  const campaignId = newCampaignId();
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port,
    secure,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await transporter.verify();
  } catch (error) {
    console.error("SMTP verification failed:", error);
    const detail = "SMTP bağlantısı doğrulanamadı; mesaj gönderilmedi.";
    for (const recipient of recipients) {
      await addEmailHistory(
        newHistoryEntry({
          campaignId,
          businessName: recipient.businessName,
          email: recipient.email.toLowerCase(),
          subject: removeHeaderBreaks(
            renderTemplate(parsedSend.data.template.subject, recipient),
          ),
          status: "failed",
          detail,
        }),
      );
    }
    await transporter.close();
    return NextResponse.json(
      {
        ok: false,
        error: "SMTP bağlantısı doğrulanamadı. Sunucu, port ve uygulama şifresini kontrol et.",
        campaignId,
        recordedFailures: recipients.length,
      },
      { status: 502 },
    );
  }

  const results: Array<{
    email: string;
    businessName: string;
    status: "sent" | "failed" | "skipped";
    detail: string;
  }> = [];
  const safeFromName = removeHeaderBreaks(parsedSend.data.template.fromName);

  for (const recipient of recipients) {
    if (results.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const email = recipient.email.toLowerCase();
    const subject = renderTemplate(parsedSend.data.template.subject, recipient);

    if (await wasRecentlySent(email, recentSendWindow)) {
      const detail = "Bu adrese son 7 gün içinde uygulama üzerinden e-posta gönderilmiş.";
      results.push({ email, businessName: recipient.businessName, status: "skipped", detail });
      await addEmailHistory(
        newHistoryEntry({
          campaignId,
          businessName: recipient.businessName,
          email,
          subject,
          status: "skipped",
          detail,
        }),
      );
      continue;
    }

    const body = [
      renderTemplate(parsedSend.data.template.body, recipient),
      renderTemplate(parsedSend.data.template.signature, recipient),
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const sent = await transporter.sendMail({
        from: { name: safeFromName, address: configuredFrom },
        to: { name: recipient.businessName, address: email },
        subject: removeHeaderBreaks(subject),
        text: body,
        html: plainTextToHtml(body),
      });
      const detail = sent.messageId ? `SMTP kabul etti (${sent.messageId}).` : "SMTP kabul etti.";
      results.push({ email, businessName: recipient.businessName, status: "sent", detail });
      await addEmailHistory(
        newHistoryEntry({
          campaignId,
          businessName: recipient.businessName,
          email,
          subject,
          status: "sent",
          detail,
        }),
      );
    } catch (error) {
      console.error("SMTP send failed:", error);
      const detail = safeSmtpError(error);
      results.push({ email, businessName: recipient.businessName, status: "failed", detail });
      await addEmailHistory(
        newHistoryEntry({
          campaignId,
          businessName: recipient.businessName,
          email,
          subject,
          status: "failed",
          detail,
        }),
      );
    }
  }

  await transporter.close();
  return NextResponse.json({
    ok: true,
    campaignId,
    total: recipients.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  });
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM,
  );
}

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();
  const hostname = normalizedHost.startsWith("[")
    ? normalizedHost.slice(1, normalizedHost.indexOf("]"))
    : normalizedHost.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function deduplicateRecipients<T extends { email: string }>(recipients: T[]): T[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const email = recipient.email.trim().toLowerCase();
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function renderTemplate(
  template: string,
  recipient: z.infer<typeof recipientSchema>,
): string {
  const variables: Record<string, string> = {
    business_name: recipient.businessName,
    business_email: recipient.email,
    business_phone: recipient.businessPhone,
    business_website: recipient.businessWebsite,
    business_address: recipient.businessAddress,
    business_category: recipient.businessCategory,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = variables[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

function removeHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"></head><body><div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#222">${escapeHtml(value).replace(/\n/g, "<br>")}</div></body></html>`;
}

function safeSmtpError(error: unknown): string {
  if (!(error instanceof Error)) return "SMTP gönderimi başarısız oldu.";
  return error.message
    .replace(/[\r\n]+/g, " ")
    .replace(/(password|pass|auth|credentials)\s*[:=]\s*\S+/gi, "$1=[gizlendi]")
    .slice(0, 300);
}
