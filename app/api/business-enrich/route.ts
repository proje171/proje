import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { NextRequest, NextResponse } from "next/server";
import type { LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

const requestSchema = z.object({
  businesses: z
    .array(
      z.object({
        placeId: z.string().min(1).max(200),
        website: z.string().url().max(2000),
      }),
    )
    .min(1)
    .max(4),
});

const maxPageBytes = 750_000;
const pageTimeoutMs = 4_000;
const maxPagesPerSite = 12;
const maxPublicSocialProfilesPerSite = 2;
const userAgent = "IBAYSOFT-Public-Contact-Finder/1.0";
const contactPathPattern =
  /(?:contact|iletisim|iletişim|bize[-_\s]?ulaşın|e[-_\s]?posta|hakkimizda|hakkımızda|about|kurumsal|corporate|impressum|legal)/i;
const emailPattern =
  /[a-z0-9.!#$%&'*+=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}/gi;

export async function POST(request: NextRequest) {
  if (!isLoopback(request.headers.get("host") || "") || !isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Bu tarama yalnızca yerel uygulamada kullanılabilir." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Geçersiz JSON isteği." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "En fazla 4 işletme için geçerli web sitesi adresi gönder." },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    parsed.data.businesses.map(async (business) => {
      try {
        const scan = await findPublicEmails(business.website);
        return {
          placeId: business.placeId,
          emails: scan.emails,
          scanStatus: scan.complete ? "complete" : "partial",
          scanMessage: scan.message,
        };
      } catch (error) {
        console.warn("Public business website scan failed:", safeErrorMessage(error));
        return {
          placeId: business.placeId,
          emails: [],
          scanStatus: "partial",
          scanMessage: getScanFailureMessage(error),
        };
      }
    }),
  );

  return NextResponse.json({ ok: true, results });
}

async function findPublicEmails(
  input: string,
): Promise<{ emails: string[]; complete: boolean; message?: string }> {
  const startUrl = await validatePublicUrl(input);
  const originHost = normalizeHost(startUrl.hostname);
  const robotsUrl = new URL("/robots.txt", startUrl);
  const robots = await readRobots(robotsUrl, originHost);
  if (!robots.complete) {
    return {
      emails: [],
      complete: false,
      message: "robots.txt dosyasına erişilemedi; site kurallarına uymak için tarama durduruldu.",
    };
  }
  const robotsBody = robots.body;
  if (!isAllowedByRobots(startUrl.pathname, robotsBody)) {
    return {
      emails: [],
      complete: false,
      message: "Web sitesi robots.txt kuralları otomatik taramaya izin vermiyor.",
    };
  }

  const queue: { url: URL; discoveredFromSite: boolean; homepage?: boolean }[] = [
    { url: startUrl, discoveredFromSite: true, homepage: true },
  ];
  const queued = new Set([canonicalPageKey(startUrl)]);
  const visited = new Set<string>();
  const emails = new Set<string>();
  const socialProfiles = new Map<SocialPlatform, URL>();
  let complete = true;
  let socialScanMessage: string | undefined;

  while (queue.length > 0 && visited.size < maxPagesPerSite) {
    const queuedPage = queue.shift()!;
    const pageUrl = queuedPage.url;
    const pageKey = canonicalPageKey(pageUrl);
    if (visited.has(pageKey)) continue;
    visited.add(pageKey);

    let response: PageResponse;
    try {
      response = await fetchPublicPage(pageUrl, originHost, 0, robotsBody);
    } catch (error) {
      console.warn("Could not read public website page:", safeErrorMessage(error));
      if (queuedPage.discoveredFromSite) complete = false;
      continue;
    }

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !/text\/html|application\/xhtml\+xml/i.test(response.contentType)
    ) {
      if (
        queuedPage.discoveredFromSite &&
        (queuedPage.homepage || ![404, 410].includes(response.status))
      ) {
        complete = false;
      }
      continue;
    }

    for (const email of extractEmails(response.body)) emails.add(email);
    for (const profile of extractOfficialSocialProfiles(response.body, response.finalUrl)) {
      if (!socialProfiles.has(profile.platform)) {
        socialProfiles.set(profile.platform, profile.url);
      }
      if (socialProfiles.size >= maxPublicSocialProfilesPerSite) break;
    }
    if (visited.size >= maxPagesPerSite) continue;

    for (const href of extractContactLinks(response.body, response.finalUrl)) {
      let linked: URL;
      try {
        linked = await validatePublicUrl(href);
      } catch (error) {
        console.warn("Could not validate public contact page:", safeErrorMessage(error));
        continue;
      }
      if (normalizeHost(linked.hostname) !== originHost) continue;
      if (!isAllowedByRobots(linked.pathname, robotsBody)) continue;
      const key = canonicalPageKey(linked);
      if (queued.has(key) || visited.has(key)) continue;
      queued.add(key);
      queue.push({ url: linked, discoveredFromSite: true });
      if (queue.length + visited.size >= maxPagesPerSite) break;
    }

    if (emails.size === 0 && visited.size === 1) {
      for (const candidate of contactPaths(startUrl)) {
        if (!isAllowedByRobots(candidate.pathname, robotsBody)) continue;
        const key = canonicalPageKey(candidate);
        if (queued.has(key) || visited.has(key)) continue;
        queued.add(key);
        queue.push({ url: candidate, discoveredFromSite: false });
        if (queue.length + visited.size >= maxPagesPerSite) break;
      }
    }
  }

  if (emails.size === 0) {
    for (const profileUrl of socialProfiles.values()) {
      try {
        const socialScan = await findPublicSocialEmails(profileUrl);
        for (const email of socialScan.emails) emails.add(email);
        if (!socialScan.complete) {
          complete = false;
          socialScanMessage = socialScan.message;
        }
        if (emails.size > 0) break;
      } catch (error) {
        console.warn("Could not read public business social profile:", safeErrorMessage(error));
        complete = false;
        socialScanMessage = "Resmî sosyal medya profilindeki herkese açık bilgilere erişilemedi.";
      }
    }
  }

  return {
    emails: Array.from(emails).slice(0, 10),
    complete,
    message: !complete
      ? socialScanMessage || "Ana siteye veya sitede bağlantısı verilen iletişim sayfasına erişilemedi."
      : emails.size > 0
        ? "Resmî web sitesinde veya bağlantısı verilen herkese açık sosyal profilde e-posta bulundu."
        : "Tarama tamamlandı; resmî web sitesinde ve kontrol edilebilen herkese açık sosyal profillerde e-posta bulunamadı.",
  };
}

async function findPublicSocialEmails(
  input: URL,
): Promise<{ emails: string[]; complete: boolean; message?: string }> {
  const profileUrl = await validatePublicUrl(input.href);
  const profileHost = normalizeHost(profileUrl.hostname);
  const platform = getSocialPlatform(profileUrl.hostname);
  if (!platform || !isSocialProfileUrl(platform, profileUrl)) {
    throw new Error("Unsupported social profile URL.");
  }

  const robots = await readRobots(new URL("/robots.txt", profileUrl), profileHost);
  if (!robots.complete) {
    return {
      emails: [],
      complete: false,
      message: "Sosyal platformun robots.txt dosyasına erişilemedi; profil taranmadı.",
    };
  }
  if (!isAllowedByRobots(profileUrl.pathname, robots.body)) {
    return {
      emails: [],
      complete: false,
      message: "Sosyal platformun robots.txt kuralları profil taramasına izin vermiyor.",
    };
  }

  const response = await fetchPublicPage(profileUrl, profileHost, 0, robots.body);
  if (response.status < 200 || response.status >= 300) {
    return {
      emails: [],
      complete: [404, 410].includes(response.status),
      message: "Herkese açık sosyal profil sayfasına erişilemedi.",
    };
  }
  if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
    return { emails: [], complete: false, message: "Sosyal profil HTML sayfası olarak sunulmadı." };
  }

  return { emails: extractEmails(response.body), complete: true };
}

async function readRobots(
  url: URL,
  allowedHost: string,
): Promise<{ body: string; complete: boolean }> {
  try {
    const response = await fetchPublicPage(url, allowedHost, 0);
    if (response.status >= 200 && response.status < 300) {
      return { body: response.body, complete: true };
    }
    return { body: "", complete: [404, 410].includes(response.status) };
  } catch (error) {
    console.warn("Could not read website robots.txt:", safeErrorMessage(error));
    return { body: "", complete: false };
  }
}

function getScanFailureMessage(error: unknown): string {
  const message = safeErrorMessage(error);
  if (/robots/i.test(message)) {
    return "robots.txt dosyasına erişilemedi; site kurallarına uymak için tarama durduruldu.";
  }
  if (/private|invalid hostname|only http|non-standard port|resolve only/i.test(message)) {
    return "Web sitesi güvenli biçimde doğrulanamadı; tarama yapılmadı.";
  }
  return "Web sitesi erişimi engellendi veya zaman aşımına uğradı.";
}

function contactPaths(home: URL): URL[] {
  return [
    "/iletisim",
    "/iletisim/",
    "/iletisim.html",
    "/iletisim-bilgileri",
    "/contact",
    "/contact-us",
    "/contact/",
    "/contact-us/",
    "/contact.html",
    "/bize-ulasin",
    "/bize-ulasin/",
    "/hakkimizda/iletisim",
    "/hakkimizda",
    "/hakkimizda/",
    "/about",
    "/kurumsal/iletisim",
  ].map((path) => new URL(path, home));
}

function canonicalPageKey(url: URL): string {
  const canonical = new URL(url.href);
  canonical.hash = "";
  canonical.search = "";
  canonical.pathname = canonical.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return canonical.href;
}

function extractContactLinks(html: string, pageUrl: URL): string[] {
  const links: string[] = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[1] || match[2] || match[3] || "").trim();
    const label = stripTags(decodeHtml(match[4] || ""));
    if (!contactPathPattern.test(`${href} ${label}`)) continue;
    try {
      const link = new URL(href, pageUrl);
      if (["http:", "https:"].includes(link.protocol)) links.push(link.href);
    } catch {
      continue;
    }
  }
  return Array.from(new Set(links));
}

type SocialPlatform = "facebook" | "instagram";

function extractOfficialSocialProfiles(
  html: string,
  pageUrl: URL,
): { platform: SocialPlatform; url: URL }[] {
  const profiles = new Map<SocialPlatform, URL>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[1] || match[2] || match[3] || "").trim();
    try {
      const url = new URL(href, pageUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const platform = getSocialPlatform(url.hostname);
      if (!platform || !isSocialProfileUrl(platform, url) || profiles.has(platform)) continue;
      const profile = new URL(url.origin + url.pathname);
      if (platform === "facebook" && url.pathname.toLowerCase() === "/profile.php") {
        const id = url.searchParams.get("id");
        if (!id || !/^\d{1,32}$/.test(id)) continue;
        profile.searchParams.set("id", id);
      }
      profiles.set(platform, profile);
    } catch {
      continue;
    }
  }
  return Array.from(profiles, ([platform, url]) => ({ platform, url }));
}

function getSocialPlatform(hostname: string): SocialPlatform | undefined {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (["facebook.com", "fb.com", "m.facebook.com", "mbasic.facebook.com"].includes(host)) {
    return "facebook";
  }
  if (host === "instagram.com") return "instagram";
  return undefined;
}

function isSocialProfileUrl(platform: SocialPlatform, url: URL): boolean {
  const segments = url.pathname.split("/").filter(Boolean);
  const reservedPaths = new Set([
    "about",
    "accounts",
    "business",
    "developers",
    "direct",
    "events",
    "explore",
    "groups",
    "help",
    "login",
    "marketplace",
    "p",
    "pages",
    "photo",
    "photos",
    "privacy",
    "reel",
    "reels",
    "share",
    "stories",
    "watch",
  ]);
  if (platform === "facebook") {
    if (url.pathname.toLowerCase() === "/profile.php") {
      return /^\d{1,32}$/.test(url.searchParams.get("id") || "");
    }
    if (segments.length === 1 && !reservedPaths.has(segments[0].toLowerCase())) return true;
    return segments.length === 3 && segments[0].toLowerCase() === "pages";
  }
  return segments.length === 1 && !reservedPaths.has(segments[0].toLowerCase());
}

function extractEmails(html: string): string[] {
  const normalizedHtml = decodeHtml(html);
  const mailtoEmails = Array.from(normalizedHtml.matchAll(/href\s*=\s*["']mailto:([^"'?#\s]+)/gi))
    .map((match) => {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    });
  const normalized = normalizedHtml
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, ".");
  const found = [...(normalized.match(emailPattern) ?? []), ...mailtoEmails.flatMap((email) => email.match(emailPattern) ?? [])];
  return Array.from(
    new Set(
      found
        .map((email) => email.replace(/[.,;:)\]}]+$/, "").toLowerCase())
        .filter((email) => !/\.(?:png|jpe?g|gif|webp|svg|css|js)$/i.test(email)),
    ),
  );
}

function decodeHtml(input: string): string {
  return input
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&colon;/gi, ":")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isAllowedByRobots(pathname: string, robots: string): boolean {
  if (!robots) return true;
  let applies = false;
  let disallowed: string[] = [];
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
      if (applies) disallowed = [];
    } else if (applies && key === "disallow" && value) {
      disallowed.push(value);
    }
  }
  return !disallowed.some((rule) => pathname.startsWith(rule));
}

type PageResponse = {
  status: number;
  contentType: string;
  body: string;
  finalUrl: URL;
};

async function fetchPublicPage(
  input: URL,
  allowedHost: string,
  redirectCount: number,
  robotsBody = "",
): Promise<PageResponse> {
  if (redirectCount > 3) throw new Error("Too many redirects.");
  const url = await validatePublicUrl(input.href);
  if (normalizeHost(url.hostname) !== allowedHost) throw new Error("Cross-domain redirect rejected.");
  if (!isAllowedByRobots(url.pathname, robotsBody)) throw new Error("Page disallowed by robots.txt.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address.address))) {
    throw new Error("Website did not resolve to a public IP address.");
  }
  const selectedAddress = addresses.find((address) => address.family === 4) ?? addresses[0];
  const response = await requestPinned(url, selectedAddress.address, selectedAddress.family);

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.location;
    if (!location) throw new Error("Redirect without location.");
    const redirected = new URL(Array.isArray(location) ? location[0] : location, url);
    const validated = await validatePublicUrl(redirected.href);
    if (normalizeHost(validated.hostname) !== allowedHost) {
      throw new Error("Cross-domain redirect rejected.");
    }
    return fetchPublicPage(validated, allowedHost, redirectCount + 1, robotsBody);
  }

  return {
    status: response.status,
    contentType: response.headers["content-type"]?.toString() ?? "",
    body: response.body,
    finalUrl: url,
  };
}

function requestPinned(
  url: URL,
  address: string,
  family: number,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const lookupPinned: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (typeof lookupOptions === "object" && lookupOptions.all) {
        callback(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    };
    const options = {
      method: "GET",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        "accept-encoding": "identity",
        connection: "close",
      },
      lookup: lookupPinned,
      timeout: pageTimeoutMs,
    };
    const onResponse = (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxPageBytes) {
          reject(new Error("Page exceeds maximum scan size."));
          response.destroy();
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    };
    const request = url.protocol === "https:"
      ? httpsRequest(url, options, onResponse)
      : httpRequest(url, options, onResponse);
    request.on("timeout", () => request.destroy(new Error("Website request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function validatePublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) sites are allowed.");
  if (url.username || url.password) throw new Error("Credentials in URL are not allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Non-standard ports are not allowed.");
  if (url.hostname.endsWith(".") || url.hostname.includes("%")) throw new Error("Invalid hostname.");
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private hosts are not allowed.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname)) throw new Error("Private IP addresses are not allowed.");
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address.address))) {
    throw new Error("Website must resolve only to public IP addresses.");
  }
  return url;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && octets[2] === 100) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized.startsWith("2") ||
      normalized.startsWith("3")
    ) && !normalized.startsWith("2001:db8:");
  }
  return false;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase();
  const hostname = normalized.startsWith("[")
    ? normalized.slice(1, normalized.indexOf("]"))
    : normalized.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 200) : "Unknown scan error.";
}
