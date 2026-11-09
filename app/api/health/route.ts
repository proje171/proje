import { NextResponse } from "next/server";

export async function GET() {
  const smtpConfigured = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM,
  );

  return NextResponse.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    config: {
      smtp: smtpConfigured,
      database: Boolean(process.env.DATABASE_URL),
      googleMaps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
    },
  });
}
