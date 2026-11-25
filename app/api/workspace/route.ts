import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const businessSchema = z.object({
  placeId: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(300),
  category: z.string().trim().max(200).default(""),
  address: z.string().trim().max(1000).default(""),
  location: z.object({ lat: z.number(), lng: z.number() }),
  rating: z.number().optional(),
  email: z.string().email().max(254).optional(),
  emailSearchStatus: z.enum(["searching", "not-found", "partial"]).optional(),
  emailSearchMessage: z.string().max(2000).optional(),
  website: z.string().max(2000).optional(),
  phone: z.string().max(100).optional(),
  chainStatus: z.enum(["chain", "unknown"]).optional(),
  chainBranchCount: z.number().int().nonnegative().optional(),
});

const statusSchema = z.enum(["green", "yellow", "red"]).nullable();
const dateSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => value === "" || !Number.isNaN(Date.parse(value)), "Geçersiz tarih.");

const searchSchema = z.object({
  action: z.literal("save-search"),
  query: z.string().trim().max(500).default(""),
  category: z.string().trim().max(200),
  radius: z.number().int().min(1).max(100_000),
  businesses: z.array(businessSchema).max(2000),
});

const updateBusinessSchema = z.object({
  action: z.literal("update-business"),
  placeId: z.string().trim().min(1).max(300),
  business: businessSchema.optional(),
  status: statusSchema.optional(),
  note: z.string().max(5000).optional(),
  followUpAt: dateSchema.nullable().optional(),
  emailConsentSource: z.string().trim().max(500).nullable().optional(),
  emailConsentDate: dateSchema.nullable().optional(),
});

const backupBusinessSchema = z.object({
  business: businessSchema,
  status: statusSchema,
  note: z.string().max(5000).default(""),
  followUpAt: dateSchema.nullable().default(null),
  emailConsentSource: z.string().max(500).nullable().default(null),
  emailConsentDate: dateSchema.nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const backupSearchSchema = z.object({
  id: z.string().min(1).max(100),
  query: z.string().max(500),
  category: z.string().max(200),
  radius: z.number().int().min(1).max(100_000),
  businessIds: z.array(z.string().min(1).max(300)).max(2000),
  createdAt: z.string().datetime({ offset: true }),
});

const backupSchema = z.object({
  format: z.literal("ibaysoft-workspace"),
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  businesses: z.array(backupBusinessSchema).max(10_000),
  searches: z.array(backupSearchSchema).max(10_000),
});

function isLoopbackHost(hostHeader: string): boolean {
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isSameOriginLoopback(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return (
    isLoopbackHost(request.headers.get("host") || "") &&
    origin !== null &&
    origin === new URL(request.url).origin
  );
}

function serializeBusiness(record: {
  placeId: string;
  data: string;
  status: string | null;
  note: string;
  followUpAt: string | null;
  emailConsentSource: string | null;
  emailConsentDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    business: businessSchema.parse(JSON.parse(record.data)),
    status: statusSchema.parse(record.status),
    note: record.note,
    followUpAt: record.followUpAt,
    emailConsentSource: record.emailConsentSource,
    emailConsentDate: record.emailConsentDate,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function serializeSearch(record: {
  id: string;
  query: string;
  category: string;
  radius: number;
  businessIds: string;
  createdAt: Date;
}) {
  const businessIds: unknown = JSON.parse(record.businessIds);
  if (!Array.isArray(businessIds) || !businessIds.every((id) => typeof id === "string")) {
    throw new Error(`Arama geçmişi kaydı geçersiz: ${record.id}`);
  }
  return { ...record, businessIds, createdAt: record.createdAt.toISOString() };
}

async function getWorkspaceData() {
  const [businesses, searches] = await Promise.all([
    prisma.businessRecord.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.searchRecord.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
  ]);
  return {
    businesses: businesses.map(serializeBusiness),
    searches: searches.map(serializeSearch),
  };
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(records: Awaited<ReturnType<typeof getWorkspaceData>>["businesses"]): string {
  const rows = [
    [
      "İşletme",
      "Kategori",
      "E-posta",
      "Telefon",
      "Web sitesi",
      "Adres",
      "Durum",
      "Not",
      "Takip tarihi",
      "İzin kaynağı",
      "İzin tarihi",
      "Google Place ID",
    ],
    ...records.map(({ business, status, note, followUpAt, emailConsentSource, emailConsentDate }) => [
      business.name,
      business.category,
      business.email,
      business.phone,
      business.website,
      business.address,
      status === "green"
        ? "Görüşüldü"
        : status === "yellow"
          ? "Potansiyel"
          : status === "red"
            ? "Anlaşılmadı"
            : "İşaretlenmedi",
      note,
      followUpAt,
      emailConsentSource,
      emailConsentDate,
      business.placeId,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export async function GET(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host") || "")) {
    return NextResponse.json({ error: "Çalışma alanı verilerine yalnızca yerel uygulamadan erişilebilir." }, { status: 403 });
  }
  try {
    const exportType = request.nextUrl.searchParams.get("export");
    const workspace = await getWorkspaceData();
    if (exportType === "csv") {
      return new NextResponse(buildCsv(workspace.businesses), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="ibaysoft-isletmeler.csv"',
          "cache-control": "no-store",
        },
      });
    }
    if (exportType === "backup") {
      return NextResponse.json(
        {
          format: "ibaysoft-workspace",
          version: 1,
          exportedAt: new Date().toISOString(),
          ...workspace,
        },
        {
          headers: {
            "content-disposition": 'attachment; filename="ibaysoft-yedek.json"',
            "cache-control": "no-store",
          },
        },
      );
    }
    return NextResponse.json(workspace, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Workspace read failed:", error);
    return NextResponse.json({ error: "Çalışma alanı verileri okunamadı." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginLoopback(request)) {
    return NextResponse.json({ error: "İstek kaynağı doğrulanamadı." }, { status: 403 });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Yedek dosyası 20 MB sınırını aşıyor." }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Geçerli bir JSON isteği gönder." }, { status: 400 });
  }

  const search = searchSchema.safeParse(payload);
  if (search.success) {
    try {
      const { businesses, query, category, radius } = search.data;
      const id = randomUUID();
      await prisma.$transaction(async (transaction) => {
        for (const business of businesses) {
          await transaction.businessRecord.upsert({
            where: { placeId: business.placeId },
            create: {
              placeId: business.placeId,
              name: business.name,
              category: business.category,
              address: business.address,
              data: JSON.stringify(business),
            },
            update: {
              name: business.name,
              category: business.category,
              address: business.address,
              data: JSON.stringify(business),
            },
          });
        }
        await transaction.searchRecord.create({
          data: { id, query: query || "Harita seçimi", category, radius, businessIds: JSON.stringify(businesses.map(({ placeId }) => placeId)) },
        });
      });
      return NextResponse.json({ ok: true, id });
    } catch (error) {
      console.error("Workspace search save failed:", error);
      return NextResponse.json({ error: "İşletme araması kaydedilemedi." }, { status: 500 });
    }
  }

  const update = updateBusinessSchema.safeParse(payload);
  if (update.success) {
    try {
      const { placeId, business, ...patch } = update.data;
      const existing = await prisma.businessRecord.findUnique({ where: { placeId } });
      if (!existing && !business) {
        return NextResponse.json({ error: "İşletme kaydı bulunamadı." }, { status: 404 });
      }
      const source = business ?? businessSchema.parse(JSON.parse(existing!.data));
      const record = await prisma.businessRecord.upsert({
        where: { placeId },
        create: {
          placeId,
          name: source.name,
          category: source.category,
          address: source.address,
          data: JSON.stringify(source),
          status: patch.status ?? null,
          note: patch.note ?? "",
          followUpAt: patch.followUpAt ?? null,
          emailConsentSource: patch.emailConsentSource ?? null,
          emailConsentDate: patch.emailConsentDate ?? null,
        },
        update: {
          name: source.name,
          category: source.category,
          address: source.address,
          data: JSON.stringify(source),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.followUpAt !== undefined ? { followUpAt: patch.followUpAt } : {}),
          ...(patch.emailConsentSource !== undefined ? { emailConsentSource: patch.emailConsentSource } : {}),
          ...(patch.emailConsentDate !== undefined ? { emailConsentDate: patch.emailConsentDate } : {}),
        },
      });
      return NextResponse.json({ ok: true, record: serializeBusiness(record) });
    } catch (error) {
      console.error("Workspace business update failed:", error);
      return NextResponse.json({ error: "İşletme bilgileri kaydedilemedi." }, { status: 500 });
    }
  }

  const backup = backupSchema.safeParse(payload);
  if (!backup.success) {
    return NextResponse.json(
      { error: "Veri biçimi tanınmadı veya yedekte geçersiz kayıtlar var.", details: backup.error.flatten() },
      { status: 400 },
    );
  }

  try {
    let businessesAdded = 0;
    let searchesAdded = 0;
    await prisma.$transaction(async (transaction) => {
      for (const item of backup.data.businesses) {
        const exists = await transaction.businessRecord.findUnique({ where: { placeId: item.business.placeId } });
        if (exists) continue;
        await transaction.businessRecord.create({
          data: {
            placeId: item.business.placeId,
            name: item.business.name,
            category: item.business.category,
            address: item.business.address,
            data: JSON.stringify(item.business),
            status: item.status,
            note: item.note,
            followUpAt: item.followUpAt,
            emailConsentSource: item.emailConsentSource,
            emailConsentDate: item.emailConsentDate,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          },
        });
        businessesAdded += 1;
      }
      for (const item of backup.data.searches) {
        const exists = await transaction.searchRecord.findUnique({ where: { id: item.id } });
        if (exists) continue;
        await transaction.searchRecord.create({
          data: {
            id: item.id,
            query: item.query,
            category: item.category,
            radius: item.radius,
            businessIds: JSON.stringify(item.businessIds),
            createdAt: new Date(item.createdAt),
          },
        });
        searchesAdded += 1;
      }
    });
    return NextResponse.json({
      ok: true,
      businessesAdded,
      searchesAdded,
      skipped: backup.data.businesses.length + backup.data.searches.length - businessesAdded - searchesAdded,
    });
  } catch (error) {
    console.error("Workspace backup restore failed:", error);
    return NextResponse.json({ error: "Yedek geri yüklenemedi; mevcut kayıtlar değiştirilmedi." }, { status: 500 });
  }
}
