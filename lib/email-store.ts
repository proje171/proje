import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type EmailTemplate = {
  id: string;
  name: string;
  fromName: string;
  subject: string;
  body: string;
  signature: string;
  updatedAt: string;
};

export type EmailHistoryEntry = {
  id: string;
  campaignId: string;
  businessName: string;
  email: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  detail: string;
  createdAt: string;
};

type EmailStore = {
  templates: EmailTemplate[];
  history: EmailHistoryEntry[];
};

const dataDirectory = path.join(process.cwd(), ".data");
const storePath = path.join(dataDirectory, "email-store.json");
const defaultTemplate: EmailTemplate = {
  id: "default-outreach",
  name: "İş birliği teklifi",
  fromName: "IBAYSOFT",
  subject: "{{business_name}} için iş birliği teklifi",
  body:
    "Merhaba {{business_name}},\n\n{{business_category}} alanındaki çalışmalarınızı inceledik. Size nasıl yardımcı olabileceğimizi konuşmak isteriz.\n\nUygunsanız bu e-postayı yanıtlayarak bize ulaşabilirsiniz.",
  signature: "İyi çalışmalar,\nIBAYSOFT",
  updatedAt: new Date(0).toISOString(),
};

let writeQueue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<EmailStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("templates" in parsed) ||
      !Array.isArray(parsed.templates) ||
      !("history" in parsed) ||
      !Array.isArray(parsed.history)
    ) {
      throw new Error("E-posta veri dosyasının biçimi geçersiz.");
    }

    const store = parsed as EmailStore;
    const repaired = repairMojibake(store);
    if (!store.templates.some((template) => template.id === defaultTemplate.id)) {
      store.templates.unshift(defaultTemplate);
    }
    if (repaired) await writeStore(store);
    return store;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { templates: [defaultTemplate], history: [] };
    }
    throw error;
  }
}

function repairMojibake(store: EmailStore): boolean {
  let changed = false;
  const repair = (value: string): string => {
    if (!/[ÃÄÅ][\u0080-\u00ff]/.test(value)) return value;
    const cp1252Extensions = new Map<number, number>([
      [0x20ac, 0x80],
      [0x201a, 0x82],
      [0x0192, 0x83],
      [0x201e, 0x84],
      [0x2026, 0x85],
      [0x2020, 0x86],
      [0x2021, 0x87],
      [0x02c6, 0x88],
      [0x2030, 0x89],
      [0x0160, 0x8a],
      [0x2039, 0x8b],
      [0x0152, 0x8c],
      [0x017d, 0x8e],
      [0x2018, 0x91],
      [0x2019, 0x92],
      [0x201c, 0x93],
      [0x201d, 0x94],
      [0x2022, 0x95],
      [0x2013, 0x96],
      [0x2014, 0x97],
      [0x02dc, 0x98],
      [0x2122, 0x99],
      [0x0161, 0x9a],
      [0x203a, 0x9b],
      [0x0153, 0x9c],
      [0x017e, 0x9e],
      [0x0178, 0x9f],
    ]);
    const bytes: number[] = [];
    for (const character of value) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint <= 0xff) bytes.push(codePoint);
      else {
        const mapped = cp1252Extensions.get(codePoint);
        if (mapped === undefined) return value;
        bytes.push(mapped);
      }
    }
    const candidate = Buffer.from(bytes).toString("utf8");
    if (candidate.includes("\uFFFD")) return value;
    if ((candidate.match(/[ÃÄÅ][\u0080-\u00ff]/g) ?? []).length >=
      (value.match(/[ÃÄÅ][\u0080-\u00ff]/g) ?? []).length) {
      return value;
    }
    changed = true;
    return candidate;
  };

  for (const template of store.templates) {
    template.name = repair(template.name);
    template.fromName = repair(template.fromName);
    template.subject = repair(template.subject);
    template.body = repair(template.body);
    template.signature = repair(template.signature);
  }
  for (const entry of store.history) {
    entry.businessName = repair(entry.businessName);
    entry.subject = repair(entry.subject);
    entry.detail = repair(entry.detail);
  }
  return changed;
}

async function writeStore(store: EmailStore): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, storePath);
}

export async function getEmailStore(): Promise<EmailStore> {
  return readStore();
}

export async function saveEmailTemplate(
  template: Omit<EmailTemplate, "updatedAt">,
): Promise<EmailTemplate> {
  return withWriteLock(async () => {
    const store = await readStore();
    const saved: EmailTemplate = { ...template, updatedAt: new Date().toISOString() };
    const index = store.templates.findIndex((item) => item.id === saved.id);
    if (index >= 0) store.templates[index] = saved;
    else store.templates.unshift(saved);
    await writeStore(store);
    return saved;
  });
}

export async function addEmailHistory(entry: EmailHistoryEntry): Promise<void> {
  await withWriteLock(async () => {
    const store = await readStore();
    store.history.unshift(entry);
    await writeStore(store);
  });
}

export async function wasRecentlySent(
  email: string,
  withinMilliseconds: number,
): Promise<boolean> {
  const store = await readStore();
  const cutoff = Date.now() - withinMilliseconds;
  return store.history.some(
    (entry) =>
      entry.status === "sent" &&
      entry.email.toLowerCase() === email.toLowerCase() &&
      Date.parse(entry.createdAt) >= cutoff,
  );
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function newHistoryEntry(
  entry: Omit<EmailHistoryEntry, "id" | "createdAt">,
): EmailHistoryEntry {
  return {
    ...entry,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

export function newCampaignId(): string {
  return randomUUID();
}
