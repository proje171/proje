import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Email API ready.",
    smtpConfigured: Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM,
    ),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const recipients = Array.isArray(body?.to) ? body.to : [];
    const subject = typeof body?.subject === "string" ? body.subject : "No subject";
    const text = typeof body?.text === "string" ? body.text : "";

    if (!recipients.length) {
      return NextResponse.json(
        { ok: false, error: "No recipients were provided." },
        { status: 400 },
      );
    }

    const smtpConfigured = Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM,
    );

    if (!smtpConfigured) {
      return NextResponse.json(
        { ok: false, error: "SMTP service is not configured.", smtpConfigured: false },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      smtpConfigured: true,
      recipients: recipients.length,
      subject,
      preview: text.slice(0, 120) || "(empty message)",
      message: "Email delivery is configured and ready to send.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
