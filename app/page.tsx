"use client";

import {
  Activity,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Copy,
  Database,
  Download,
  FileText,
  Eye,
  EyeOff,
  History,
  Inbox,
  Mail,
  MapPin,
  Plus,
  RotateCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import GoogleBusinessMap, { type FoundBusiness } from "./components/google-business-map-client";

type View = "dashboard" | "finder" | "businesses" | "search-history" | "email" | "email-history";
type StatusColor = "green" | "yellow" | "red" | null;
type StatusGroup = "contacted" | "potential" | "unclear";
type EmailTemplate = {
  id: string;
  name: string;
  fromName: string;
  subject: string;
  body: string;
  signature: string;
  updatedAt?: string;
};
type EmailHistoryEntry = {
  id: string;
  campaignId: string;
  businessName: string;
  email: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  detail: string;
  createdAt: string;
};
type ManualEmailRecipient = {
  id: string;
  email: string;
  name: string;
};
type EmailPersonalization = {
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  category?: string;
};
type WorkspaceBusiness = {
  business: FoundBusiness;
  status: StatusColor;
  note: string;
  followUpAt: string | null;
  emailConsentSource: string | null;
  emailConsentDate: string | null;
  createdAt: string;
  updatedAt: string;
};
type WorkspaceSearch = {
  id: string;
  query: string;
  category: string;
  radius: number;
  businessIds: string[];
  createdAt: string;
};
type WorkspaceDraft = {
  note: string;
  followUpAt: string;
  emailConsentSource: string;
  emailConsentDate: string;
};
type WorkspaceUpdate = Partial<Pick<
  WorkspaceBusiness,
  "status" | "note" | "followUpAt" | "emailConsentSource" | "emailConsentDate"
>>;

const initialTemplate: EmailTemplate = {
  id: "default-outreach",
  name: "İş birliği teklifi",
  fromName: "IBAYSOFT",
  subject: "{{business_name}} için iş birliği teklifi",
  body: "Merhaba {{business_name}},\n\n{{business_category}} alanındaki çalışmalarınızı inceledik. Size nasıl yardımcı olabileceğimizi konuşmak isteriz.\n\nUygunsanız bu e-postayı yanıtlayarak bize ulaşabilirsiniz.",
  signature: "İyi çalışmalar,\nIBAYSOFT",
};

const categoryOptions = [
  "Tüm işletmeler",
  "Restoran",
  "Kafe",
  "Kuaför",
  "Güzellik salonu",
  "Otel",
  "Market",
  "Emlak",
  "Spor salonu",
  "Diş kliniği",
  "Oto servis",
  "Mobilya",
  "Giyim",
  "E-ticaret",
  "Diğer",
];

const statusNames: Record<Exclude<StatusColor, null>, string> = {
  green: "Görüşüldü",
  yellow: "Potansiyel",
  red: "Anlaşılmadı",
};

export default function Home() {
  const [view, setView] = useState<View | "businesses" | "search-history">("dashboard");
  const [statusDetail, setStatusDetail] = useState<StatusGroup | null>(null);
  const [businesses, setBusinesses] = useState<FoundBusiness[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StatusColor>>({});
  const [businessRecords, setBusinessRecords] = useState<WorkspaceBusiness[]>([]);
  const [businessDrafts, setBusinessDrafts] = useState<Record<string, WorkspaceDraft>>({});
  const [businessListFilter, setBusinessListFilter] = useState("");
  const [businessPage, setBusinessPage] = useState(0);
  const [searchHistory, setSearchHistory] = useState<WorkspaceSearch[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(5000);
  const [category, setCategory] = useState(categoryOptions[0]);
  const [notice, setNotice] = useState("");
  const [searchError, setSearchError] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [manualRecipients, setManualRecipients] = useState<ManualEmailRecipient[]>([]);
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [manualRecipientName, setManualRecipientName] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [locationNonce, setLocationNonce] = useState(0);
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([initialTemplate]);
  const [templateDraft, setTemplateDraft] = useState<EmailTemplate>(initialTemplate);
  const [emailHistory, setEmailHistory] = useState<EmailHistoryEntry[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [emailLoading, setEmailLoading] = useState(true);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailRescanning, setEmailRescanning] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [emailFilter, setEmailFilter] = useState("");

  function applyWorkspaceData(data: { businesses: WorkspaceBusiness[]; searches: WorkspaceSearch[] }) {
    setBusinessRecords(data.businesses);
    setSearchHistory(data.searches);
    setStatuses(Object.fromEntries(data.businesses.map((record) => [record.business.placeId, record.status])));
    setBusinessDrafts(Object.fromEntries(data.businesses.map((record) => [record.business.placeId, {
      note: record.note,
      followUpAt: record.followUpAt?.slice(0, 10) || "",
      emailConsentSource: record.emailConsentSource || "",
      emailConsentDate: record.emailConsentDate?.slice(0, 10) || "",
    }])));
    const latestSearch = data.searches[0];
    if (latestSearch) {
      const byId = new Map(data.businesses.map((record) => [record.business.placeId, record.business]));
      setBusinesses(latestSearch.businessIds.flatMap((id) => {
        const business = byId.get(id);
        return business ? [business] : [];
      }));
      setQuery(latestSearch.query === "Harita seçimi" ? "" : latestSearch.query);
      setCategory(latestSearch.category);
      setRadius(latestSearch.radius);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/email")
      .then(async (response) => {
        if (!response.ok) throw new Error("E-posta ayarları yüklenemedi.");
        return (await response.json()) as {
          templates: EmailTemplate[];
          history: EmailHistoryEntry[];
          smtpConfigured: boolean;
          smtpFrom: string;
        };
      })
      .then((data) => {
        if (!active) return;
        const templates = data.templates.length ? data.templates : [initialTemplate];
        setEmailTemplates(templates);
        setTemplateDraft(templates[0]);
        setEmailHistory(data.history);
        setSmtpConfigured(data.smtpConfigured);
        setSmtpFrom(data.smtpFrom);
      })
      .catch(() => {
        if (active) setNotice("E-posta şablonları yüklenemedi. Sunucu ayakta mı kontrol et.");
      })
      .finally(() => {
        if (active) setEmailLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/workspace")
      .then(async (response) => {
        const data = (await response.json()) as {
          error?: string;
          businesses?: WorkspaceBusiness[];
          searches?: WorkspaceSearch[];
        };
        if (!response.ok || !Array.isArray(data.businesses) || !Array.isArray(data.searches)) {
          throw new Error(data.error || "Kaydedilmiş işletmeler yüklenemedi.");
        }
        return data as { businesses: WorkspaceBusiness[]; searches: WorkspaceSearch[] };
      })
      .then((data) => {
        if (active) applyWorkspaceData(data);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Kaydedilmiş işletmeler yüklenemedi.");
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!statusDetail) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setStatusDetail(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [statusDetail]);

  const visibleBusinesses = useMemo(
    () => businesses.filter((business) => !hidden.includes(business.placeId)),
    [businesses, hidden],
  );
  const recipients = useMemo(
    () =>
      visibleBusinesses.filter(
        (business) => business.email && statuses[business.placeId] !== "red",
      ),
    [statuses, visibleBusinesses],
  );
  const selectedEmailRecipients = useMemo(() => {
    const businessesToSend = recipients
      .filter((business) => selectedRecipients.includes(business.placeId))
      .map((business) => ({
        email: business.email!,
        businessName: business.name,
        businessCategory: business.category,
        businessPhone: business.phone || "",
        businessWebsite: business.website || "",
        businessAddress: business.address,
      }));
    const manualToSend = manualRecipients
      .filter((recipient) => selectedRecipients.includes(recipient.id))
      .map((recipient) => ({
        email: recipient.email,
        businessName: recipient.name || recipient.email,
        businessCategory: "Manuel alıcı",
        businessPhone: "",
        businessWebsite: "",
        businessAddress: "",
      }));
    return [...businessesToSend, ...manualToSend];
  }, [manualRecipients, recipients, selectedRecipients]);
  const previewRecipient = selectedEmailRecipients[0]
    ? {
        name: selectedEmailRecipients[0].businessName,
        email: selectedEmailRecipients[0].email,
        category: selectedEmailRecipients[0].businessCategory,
        phone: selectedEmailRecipients[0].businessPhone,
        website: selectedEmailRecipients[0].businessWebsite,
        address: selectedEmailRecipients[0].businessAddress,
      }
    : recipients[0];
  const emailCandidates = useMemo(
    () =>
      visibleBusinesses.filter((business) =>
        `${business.name} ${business.email ?? ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(emailFilter.toLocaleLowerCase("tr-TR")),
      ),
    [emailFilter, visibleBusinesses],
  );
  const statusDetails = useMemo(
    () => ({
      contacted: {
        title: "Görüşüldü",
        description: "Görüşme yaptığın işletmeler.",
        businesses: businessRecords.filter((record) => record.status === "green").map((record) => record.business),
      },
      potential: {
        title: "Potansiyel",
        description: "Takip etmek istediğin potansiyel işletmeler.",
        businesses: businessRecords.filter((record) => record.status === "yellow").map((record) => record.business),
      },
      unclear: {
        title: "Anlaşılmadı",
        description: "Anlaşılmadı olarak işaretlediğin işletmeler.",
        businesses: businessRecords.filter((record) => record.status === "red").map((record) => record.business),
      },
    }),
    [businessRecords],
  );

  function setStatus(placeId: string, status: StatusColor) {
    void saveBusinessUpdate(placeId, { status });
  }

  async function saveBusinessUpdate(
    placeId: string,
    patch: WorkspaceUpdate,
    businessOverride?: FoundBusiness,
  ) {
    const business =
      businessOverride ||
      businesses.find((item) => item.placeId === placeId) ||
      businessRecords.find((record) => record.business.placeId === placeId)?.business;
    if (!business) {
      setNotice("İşletme bilgisi bulunamadığı için değişiklik kaydedilemedi.");
      return;
    }
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update-business", placeId, business, ...patch }),
      });
      const data = (await response.json()) as { error?: string; record?: WorkspaceBusiness };
      if (!response.ok || !data.record) {
        throw new Error(data.error || "İşletme bilgileri kaydedilemedi.");
      }
      const saved = data.record;
      setBusinessRecords((current) => [
        saved,
        ...current.filter((record) => record.business.placeId !== placeId),
      ]);
      setStatuses((current) => ({ ...current, [placeId]: saved.status }));
      setBusinessDrafts((current) => ({
        ...current,
        [placeId]: {
          note: saved.note,
          followUpAt: saved.followUpAt?.slice(0, 10) || "",
          emailConsentSource: saved.emailConsentSource || "",
          emailConsentDate: saved.emailConsentDate?.slice(0, 10) || "",
        },
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "İşletme bilgileri kaydedilemedi.");
    }
  }

  function hideBusiness(placeId: string) {
    setHidden((current) => [...new Set([...current, placeId])]);
  }

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setNotice("E-posta adresi kopyalandı.");
    } catch {
      setNotice("Panoya kopyalanamadı. E-posta adresini elle seçip kopyalayabilirsin.");
    }
    window.setTimeout(() => setNotice(""), 3200);
  }

  function updateSearchResults(results: FoundBusiness[]) {
    setBusinesses(results);
    setHidden([]);
    setSelectedRecipients([]);
    setFocusedPlaceId(null);
    if (results.length === 0) return;
    void (async () => {
      try {
        const response = await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "save-search",
            query: query.trim(),
            category,
            radius,
            businesses: results,
          }),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Arama geçmişi kaydedilemedi.");
        const workspaceResponse = await fetch("/api/workspace");
        const workspace = (await workspaceResponse.json()) as {
          error?: string;
          businesses?: WorkspaceBusiness[];
          searches?: WorkspaceSearch[];
        };
        if (!workspaceResponse.ok || !workspace.businesses || !workspace.searches) {
          throw new Error(workspace.error || "Kaydedilen işletmeler yenilenemedi.");
        }
        applyWorkspaceData(workspace as { businesses: WorkspaceBusiness[]; searches: WorkspaceSearch[] });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "İşletme araması kaydedilemedi.");
      }
    })();
  }

  function updateEnriched(
    placeId: string,
    email: string | undefined,
    scanStatus: "complete" | "partial",
    scanMessage?: string,
  ) {
    const previous = businesses.find((business) => business.placeId === placeId);
    const enrichedBusiness = previous
      ? {
          ...previous,
          email,
          emailSearchStatus: email ? undefined : scanStatus === "complete" ? "not-found" as const : "partial" as const,
          emailSearchMessage: email ? undefined : scanMessage,
        }
      : undefined;
    setBusinesses((current) =>
      current.map((business) =>
        business.placeId === placeId && enrichedBusiness ? enrichedBusiness : business,
      ),
    );
    if (enrichedBusiness) void saveBusinessUpdate(placeId, {}, enrichedBusiness);
  }

  async function retryEmailSearch(business: FoundBusiness) {
    if (!business.website) {
      setNotice("Bu işletme için Google Places web sitesi bilgisi bulunmuyor.");
      return;
    }

    updateEnriched(business.placeId, undefined, "partial");
    setBusinesses((current) =>
      current.map((item) =>
        item.placeId === business.placeId
          ? { ...item, emailSearchStatus: "searching" }
          : item,
      ),
    );
    try {
      const response = await fetch("/api/business-enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businesses: [{ placeId: business.placeId, website: business.website }],
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        results?: {
          placeId: string;
          emails: string[];
          scanStatus: "complete" | "partial";
          scanMessage?: string;
        }[];
      };
      if (!response.ok || !data.results?.length) {
        throw new Error(data.error || "Resmî web sitesi taraması yapılamadı.");
      }
      const result = data.results[0];
      updateEnriched(result.placeId, result.emails[0], result.scanStatus, result.scanMessage);
      setNotice(
        result.emails.length
          ? `${business.name} için herkese açık e-posta bulundu.`
          : result.scanMessage || "Tarama tamamlandı; yayımlanmış e-posta adresi bulunamadı.",
      );
    } catch (error) {
      updateEnriched(business.placeId, undefined, "partial");
      setNotice(error instanceof Error ? error.message : "E-posta araması başarısız oldu.");
    }
    window.setTimeout(() => setNotice(""), 5000);
  }

  async function rescanBusinesses() {
    const scanTargets = visibleBusinesses.filter((business) => business.website && !business.email);
    if (!scanTargets.length) {
      setNotice("Yeniden taranabilecek web sitesi bulunmuyor.");
      window.setTimeout(() => setNotice(""), 4000);
      return;
    }

    setEmailRescanning(true);
    setBusinesses((current) =>
      current.map((business) =>
        scanTargets.some((target) => target.placeId === business.placeId)
          ? { ...business, emailSearchStatus: "searching", emailSearchMessage: undefined }
          : business,
      ),
    );
    let foundCount = 0;
    const completedPlaceIds = new Set<string>();
    try {
      for (let index = 0; index < scanTargets.length; index += 4) {
        const batch = scanTargets.slice(index, index + 4);
        const response = await fetch("/api/business-enrich", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businesses: batch.map(({ placeId, website }) => ({ placeId, website })),
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          results?: {
            placeId: string;
            emails: string[];
            scanStatus: "complete" | "partial";
            scanMessage?: string;
          }[];
        };
        if (!response.ok || !Array.isArray(data.results)) {
          throw new Error(data.error || "Web sitesi taraması yapılamadı.");
        }
        for (const result of data.results) {
          completedPlaceIds.add(result.placeId);
          updateEnriched(result.placeId, result.emails[0], result.scanStatus, result.scanMessage);
          if (result.emails.length) foundCount += 1;
        }
      }
      setNotice(`${scanTargets.length} resmî site yeniden tarandı; ${foundCount} işletme için e-posta bulundu.`);
    } catch (error) {
      for (const business of scanTargets.filter((item) => !completedPlaceIds.has(item.placeId))) {
        updateEnriched(business.placeId, undefined, "partial");
      }
      setNotice(error instanceof Error ? error.message : "E-posta taraması tamamlanamadı.");
    } finally {
      setEmailRescanning(false);
      window.setTimeout(() => setNotice(""), 6000);
    }
  }

  function toggleRecipient(placeId: string) {
    setSelectedRecipients((current) =>
      current.includes(placeId)
        ? current.filter((id) => id !== placeId)
        : current.length < 30
          ? [...current, placeId]
          : current,
    );
  }

  function addManualRecipient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = manualRecipientEmail.trim().toLocaleLowerCase("en-US");
    const name = manualRecipientName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice("Geçerli bir e-posta adresi gir.");
      return;
    }
    if (
      recipients.some((recipient) => recipient.email?.toLocaleLowerCase("en-US") === email) ||
      manualRecipients.some((recipient) => recipient.email === email)
    ) {
      setNotice("Bu e-posta adresi alıcı listesinde zaten var.");
      return;
    }
    if (selectedRecipients.length >= 30) {
      setNotice("Tek gönderimde en fazla 30 alıcı seçebilirsin.");
      return;
    }
    const recipient = { id: `manual:${crypto.randomUUID()}`, email, name };
    setManualRecipients((current) => [...current, recipient]);
    setSelectedRecipients((current) => [...current, recipient.id]);
    setManualRecipientEmail("");
    setManualRecipientName("");
    setNotice("Manuel e-posta adresi alıcı listesine eklendi.");
    window.setTimeout(() => setNotice(""), 3500);
  }

  function removeManualRecipient(id: string) {
    setManualRecipients((current) => current.filter((recipient) => recipient.id !== id));
    setSelectedRecipients((current) => current.filter((recipientId) => recipientId !== id));
  }

  async function refreshEmailHistory() {
    setHistoryRefreshing(true);
    try {
      const response = await fetch("/api/email");
      const data = (await response.json()) as {
        error?: string;
        history?: EmailHistoryEntry[];
        smtpConfigured?: boolean;
        smtpFrom?: string;
      };
      if (!response.ok || !Array.isArray(data.history)) {
        throw new Error(data.error || "E-posta geçmişi yüklenemedi.");
      }
      setEmailHistory(data.history);
      setSmtpConfigured(Boolean(data.smtpConfigured));
      setSmtpFrom(data.smtpFrom || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "E-posta geçmişi yüklenemedi.");
    } finally {
      setHistoryRefreshing(false);
    }
  }

  function updateTemplate(field: keyof EmailTemplate, value: string) {
    setTemplateDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveTemplate() {
    setTemplateSaving(true);
    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-template", template: templateDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Şablon kaydedilemedi.");
      const saved = data.template as EmailTemplate;
      setEmailTemplates((current) => {
        const exists = current.some((template) => template.id === saved.id);
        return exists
          ? current.map((template) => (template.id === saved.id ? saved : template))
          : [saved, ...current];
      });
      setTemplateDraft(saved);
      setNotice("E-posta şablonu kaydedildi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Şablon kaydedilemedi.");
    } finally {
      setTemplateSaving(false);
      window.setTimeout(() => setNotice(""), 4000);
    }
  }

  function createTemplate() {
    const newTemplate: EmailTemplate = {
      ...initialTemplate,
      id: crypto.randomUUID(),
      name: "Yeni şablon",
    };
    setEmailTemplates((current) => [newTemplate, ...current]);
    setTemplateDraft(newTemplate);
  }

  function interpolate(template: string, business?: EmailPersonalization) {
    const values: Record<string, string> = {
      business_name: business?.name || "Örnek İşletme",
      business_email: business?.email || "ornek@isletme.com",
      business_phone: business?.phone || "Bulunamadı",
      business_website: business?.website || "Bulunamadı",
      business_address: business?.address || "İstanbul",
      business_category: business?.category || "İşletme",
    };
    return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) =>
      values[key.toLowerCase()] ?? match,
    );
  }

  async function sendEmail() {
    if (selectedEmailRecipients.length === 0 || !consentConfirmed) {
      setNotice("Gönderim için alıcıları seç ve ticari ileti izinlerini doğrula.");
      window.setTimeout(() => setNotice(""), 4000);
      return;
    }
    if (selectedEmailRecipients.length > 30) {
      setNotice("Tek gönderimde en fazla 30 alıcı seçebilirsin.");
      return;
    }
    const confirmed = window.confirm(
      `${selectedEmailRecipients.length} alıcıya kişiselleştirilmiş e-posta gönderilecek. Bu alıcıların ileti iznine sahip olduğunu ve ret listende olmadıklarını doğruluyor musun?`,
    );
    if (!confirmed) return;

    setEmailSending(true);
    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send",
          template: templateDraft,
          consentConfirmed,
          recipients: selectedEmailRecipients,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "E-posta gönderimi başarısız oldu.");
      const historyResponse = await fetch("/api/email");
      if (historyResponse.ok) {
        const refreshed = await historyResponse.json();
        setEmailHistory(refreshed.history);
        setSmtpConfigured(refreshed.smtpConfigured);
        setSmtpFrom(refreshed.smtpFrom);
      }
      setNotice(
        `Gönderim tamamlandı: ${data.sent} kabul edildi, ${data.failed} başarısız, ${data.skipped} tekrar nedeniyle atlandı.`,
      );
      setSelectedRecipients([]);
      setConsentConfirmed(false);
      setView("email-history");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "E-posta gönderimi başarısız oldu.");
    } finally {
      setEmailSending(false);
      window.setTimeout(() => setNotice(""), 7000);
    }
  }

  const dueFollowUps = businessRecords
    .filter((record) => record.followUpAt && record.followUpAt.slice(0, 10) <= new Date().toISOString().slice(0, 10))
    .sort((left, right) => (left.followUpAt || "").localeCompare(right.followUpAt || ""));
  const filteredBusinessRecords = businessRecords.filter((record) =>
    `${record.business.name} ${record.business.email ?? ""} ${record.business.address} ${record.note}`
      .toLocaleLowerCase("tr-TR")
      .includes(businessListFilter.toLocaleLowerCase("tr-TR")),
  );
  const businessPageSize = 20;
  const businessPageCount = Math.max(1, Math.ceil(filteredBusinessRecords.length / businessPageSize));
  const currentBusinessPage = Math.min(businessPage, businessPageCount - 1);
  const displayedBusinessRecords = filteredBusinessRecords.slice(
    currentBusinessPage * businessPageSize,
    (currentBusinessPage + 1) * businessPageSize,
  );

  function openSavedSearch(search: WorkspaceSearch) {
    const businessesById = new Map(
      businessRecords.map((record) => [record.business.placeId, record.business]),
    );
    setBusinesses(search.businessIds.flatMap((id) => {
      const business = businessesById.get(id);
      return business ? [business] : [];
    }));
    setQuery(search.query === "Harita seçimi" ? "" : search.query);
    setCategory(search.category);
    setRadius(search.radius);
    setHidden([]);
    setFocusedPlaceId(search.businessIds[0] ?? null);
    setView("finder");
  }

  function openSavedBusiness(record: WorkspaceBusiness) {
    setBusinesses((current) =>
      current.some((business) => business.placeId === record.business.placeId)
        ? current
        : [...current, record.business],
    );
    setHidden((current) => current.filter((id) => id !== record.business.placeId));
    setFocusedPlaceId(record.business.placeId);
    setView("finder");
  }

  async function restoreWorkspaceBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!window.confirm("Yedek mevcut kayıtlarla birleştirilecek. Çakışan kayıtlar korunur; bu işlem kayıt silmez. Devam edilsin?")) {
        return;
      }
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(backup),
      });
      const data = (await response.json()) as {
        error?: string;
        businessesAdded?: number;
        searchesAdded?: number;
        skipped?: number;
      };
      if (!response.ok) throw new Error(data.error || "Yedek geri yüklenemedi.");
      const workspaceResponse = await fetch("/api/workspace");
      const workspace = (await workspaceResponse.json()) as {
        error?: string;
        businesses?: WorkspaceBusiness[];
        searches?: WorkspaceSearch[];
      };
      if (!workspaceResponse.ok || !workspace.businesses || !workspace.searches) {
        throw new Error(workspace.error || "Geri yüklenen veriler okunamadı.");
      }
      applyWorkspaceData(workspace as { businesses: WorkspaceBusiness[]; searches: WorkspaceSearch[] });
      setNotice(`Yedek birleştirildi: ${data.businessesAdded} işletme, ${data.searchesAdded} arama eklendi; ${data.skipped} kayıt çakışma nedeniyle korundu.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Yedek geri yüklenemedi.");
    } finally {
      input.value = "";
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">İB</div>
          <div>
            <div className="brand-name">İBAYSOFT</div>
            <div className="brand-caption">BUSINESS INTELLIGENCE</div>
          </div>
        </div>
        <div className="workspace-label">ÇALIŞMA ALANI</div>
        <nav className="side-nav" aria-label="Ana menü">
          <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
            <Activity size={17} /> Genel Bakış
          </button>
          <button className={`nav-item ${view === "finder" ? "active" : ""}`} onClick={() => setView("finder")}>
            <Compass size={17} /> İşletme Bul
          </button>
          <button className={`nav-item ${view === "businesses" ? "active" : ""}`} onClick={() => setView("businesses")}>
            <Database size={17} /> İşletmelerim
            {businessRecords.length > 0 && <span className="nav-count">{businessRecords.length}</span>}
          </button>
          <button className={`nav-item ${view === "search-history" ? "active" : ""}`} onClick={() => setView("search-history")}>
            <History size={17} /> Arama Geçmişi
          </button>
          <button className={`nav-item ${view === "email" ? "active" : ""}`} onClick={() => setView("email")}>
            <Mail size={17} /> E-posta Gönder
            {visibleBusinesses.length > 0 && <span className="nav-count">{visibleBusinesses.length}</span>}
          </button>
          <button className={`nav-item ${view === "email-history" ? "active" : ""}`} onClick={() => setView("email-history")}>
            <FileText size={17} /> E-posta Geçmişi
          </button>
          <button className="nav-item" onClick={() => setView("finder")}>
            <MapPin size={17} /> Harita
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={17} />
            <div><strong>Veri güvenliği</strong><span>Yalnızca herkese açık işletme bilgileri</span></div>
          </div>
          <button className="nav-item" onClick={() => setNotice("Ayarlar: Google Maps API anahtarını .env.local dosyasında yönetebilirsin.")}>
            <Settings2 size={17} /> Ayarlar
          </button>
          <div className="profile-row"><div className="avatar">İ</div><div><strong>IBAYSOFT</strong><span>Yerel çalışma alanı</span></div><ChevronDown size={15} /></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>IBAYSOFT</span><span className="crumb-slash">/</span><strong>{view === "dashboard" ? "Genel Bakış" : view === "finder" ? "İşletme Bul" : view === "businesses" ? "İşletmelerim" : view === "search-history" ? "Arama Geçmişi" : view === "email-history" ? "E-posta Geçmişi" : "E-posta Gönder"}</strong></div>
          <div className="topbar-actions"><span className="live-indicator"><i /> Yerel çalışma alanı</span><button className="icon-button" aria-label="Yardım" onClick={() => setNotice("İşletme aramak için İşletme Bul bölümünden konum ve yarıçap seç.")}><CircleHelp size={17} /></button></div>
        </header>

        {view === "dashboard" && (
          <div className="page-content">
            <div className="page-heading">
              <div><div className="eyebrow"><Sparkles size={14} /> İŞ GELİŞTİRME MERKEZİ</div><h1>İşletmelerini keşfet.</h1><p>İşletmeleri durumlarına göre takip et; kartlara tıklayarak listedeki kayıtları gör.</p></div>
              <button className="primary-button" onClick={() => setView("finder")}><Search size={16} /> İşletme ara <ArrowUpRight size={15} /></button>
            </div>
            <div className="stats-grid">
              <StatCard icon={<Users size={17}/>} label="Görüşüldü" value={statusDetails.contacted.businesses.length} note="Görüşme yapılan işletmeler" accent="green" onClick={() => setStatusDetail("contacted")} />
              <StatCard icon={<Target size={17}/>} label="Potansiyel" value={statusDetails.potential.businesses.length} note="Takip edilecek işletmeler" accent="amber" onClick={() => setStatusDetail("potential")} />
              <StatCard icon={<CircleHelp size={17}/>} label="Anlaşılmadı" value={statusDetails.unclear.businesses.length} note="Anlaşılmadı olarak işaretlenen işletmeler" accent="blue" onClick={() => setStatusDetail("unclear")} />
            </div>
            <section className="panel-card follow-up-summary">
              <div><div className="eyebrow"><History size={13}/> TAKİP HATIRLATMALARI</div><strong>{dueFollowUps.length} takip zamanı geldi</strong><p>Notları ve sonraki arama tarihlerini İşletmelerim bölümünden yönetebilirsin.</p></div>
              <button className="secondary-button" onClick={() => setView("businesses")}>İşletmelerimi aç <ArrowUpRight size={14}/></button>
            </section>
            <div className="dashboard-grid">
              <section className="panel-card welcome-card">
                <div className="card-title-row"><div><div className="eyebrow">PLATFORMANIN AMACI</div><h2>Yerel işletmeleri keşfet ve takip et</h2></div><div className="round-icon"><Compass size={19}/></div></div>
                <p>IBAYSOFT, seçtiğin konum ve sektördeki işletmeleri keşfetmek, herkese açık iletişim bilgilerini düzenlemek ve iş geliştirme sürecini tek yerden takip etmek için tasarlandı.</p>
                <div className="purpose-points">
                  <div><MapPin size={14}/><span>Konuma ve kategoriye göre işletme arama</span></div>
                  <div><Mail size={14}/><span>İşletmelerin resmî sitelerinde yayımlanan e-postaları bulma</span></div>
                  <div><Target size={14}/><span>Görüşme ve potansiyel durumlarını düzenleme</span></div>
                </div>
                <button className="secondary-button" onClick={() => setView("finder")}>Haritadan keşfet <ArrowUpRight size={15}/></button>
              </section>
              <section className="panel-card breakdown-card">
                <div className="card-title-row"><div><div className="eyebrow">KULLANIM AKIŞI</div><h2>Nasıl çalışır?</h2></div><SlidersHorizontal size={17} className="muted-icon"/></div>
                <ol className="workflow-list">
                  <li><span>1</span><div><strong>Konumu ve sektörü seç</strong><p>Adres ara, haritada merkez belirle veya mevcut konumunu kullan.</p></div></li>
                  <li><span>2</span><div><strong>İşletmeleri ve açık iletişim bilgilerini incele</strong><p>Sonuçlar Google Places hizmetinden gelir; e-posta yalnızca resmî sitede açıkça yayımlanmışsa gösterilir.</p></div></li>
                  <li><span>3</span><div><strong>Durum ver ve iletişimi yönet</strong><p>İşletmeleri görüşüldü ya da potansiyel olarak işaretle; e-postayı yalnızca gerekli izinler varsa hazırla.</p></div></li>
                </ol>
                {businesses.length > 0 && <div className="summary-rows"><div><span>Görünür işletmeler</span><strong>{visibleBusinesses.length}</strong></div><div><span>Gizlenen işletmeler</span><strong>{hidden.length}</strong></div><div><span>E-posta adresi olan</span><strong>{recipients.length}</strong></div></div>}
              </section>
            </div>
            <div className="footnote"><ShieldCheck size={14}/> Kartlar bu cihazda kaydedilmiş işletme durumlarını gösterir. Harita araması Google Places üzerinden yapılır.</div>
          </div>
        )}

        {view === "finder" && (
          <div className="finder-page">
            <div className="finder-heading"><div><div className="eyebrow"><MapPin size={13}/> KONUM TABANLI KEŞİF</div><h1>İşletme bul</h1><p>Seçilen alan {Math.min(7, Math.max(3, Math.ceil(radius / 1000))) ** 2} örtüşen bölgede ve işletme türlerine göre taranır. Her Google Places sorgusu en fazla 20 sonuç döndürür; yoğun alanlarda Google’ın sonuç sınırı yine geçerlidir.</p></div><div className="result-pill"><span className="result-dot"/>{visibleBusinesses.length} işletme</div></div>
            <div className="search-toolbar">
              <div className="search-box"><Search size={17}/><input aria-label="Şehir, mahalle veya adres ara" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {if(event.key === "Enter") setSearchNonce((nonce) => nonce + 1);}} placeholder="Şehir, mahalle veya adres ara..." /><button id="map-search-button" className="search-submit" disabled={searching} onClick={() => setSearchNonce((nonce) => nonce + 1)}>{searching ? "Aranıyor..." : "Ara"}</button></div>
              <label className="select-box"><SlidersHorizontal size={15}/><select value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="select-box"><Target size={15}/><select value={radius} onChange={(event) => setRadius(Number(event.target.value))}><option value={1000}>1 km</option><option value={2000}>2 km</option><option value={5000}>5 km</option><option value={10000}>10 km</option><option value={15000}>15 km</option></select></label>
              <button className="location-button" disabled={searching} onClick={() => setLocationNonce((nonce) => nonce + 1)}><MapPin size={15}/> Mevcut konum</button>
            </div>
            <div className="finder-layout">
              <div className="map-frame"><GoogleBusinessMap businesses={visibleBusinesses} statuses={statuses} onResults={updateSearchResults} onEnriched={updateEnriched} onSearching={setSearching} onNotice={setNotice} onSearchError={setSearchError} externalQuery={query} externalCategory={category} externalRadius={radius} searchNonce={searchNonce} locationNonce={locationNonce} focusedPlaceId={focusedPlaceId} /></div>
              <section className="results-panel">
                <div className="results-header"><div><h2>Arama sonuçları</h2><span>{visibleBusinesses.length ? `${visibleBusinesses.length} işletme bulundu` : "Konumuna göre keşfet"}</span></div><button className="icon-button small" title="Sonuçları temizle" onClick={() => updateSearchResults([])}><EyeOff size={16}/></button></div>
                <div className="business-list">
                  {visibleBusinesses.length === 0 ? <div className="empty-results"><div className="empty-icon large">{searchError ? <CircleHelp size={22}/> : <MapPin size={22}/>}</div><strong>{searchError ? "Arama tamamlanamadı" : "Henüz sonuç yok"}</strong><p>{searchError || "Konum yazıp Ara’ya bas veya haritada bir noktaya tıkla."}</p>{!searchError && <span>İşletme sonuçları Google Places API’den gelir.</span>}</div> :
                    visibleBusinesses.map((business) => <BusinessCard key={business.placeId} business={business} status={statuses[business.placeId] ?? null} onStatus={setStatus} onHide={hideBusiness} onCopy={copyEmail} onShowMap={() => setFocusedPlaceId(business.placeId)}/>)}
                </div>
                {hidden.length > 0 && <div className="hidden-footer"><Eye size={14}/> {hidden.length} gizli işletme <button onClick={() => setHidden([])}>Tümünü göster</button></div>}
              </section>
            </div>
          </div>
        )}

        {view === "businesses" && (
          <div className="page-content">
            <div className="page-heading">
              <div><div className="eyebrow"><Database size={14}/> KAYITLI ÇALIŞMA ALANI</div><h1>İşletmelerim</h1><p>İşletmeler, durumlar, notlar, takip tarihleri ve izin kayıtları bu cihazdaki SQLite veritabanında saklanır.</p></div>
              <div className="workspace-export-actions">
                <a className="secondary-button" href="/api/workspace?export=csv" download><Download size={15}/> CSV indir</a>
                <a className="secondary-button" href="/api/workspace?export=backup" download><Download size={15}/> Yedek indir</a>
                <label className="secondary-button backup-upload"><Upload size={15}/> Yedek birleştir<input type="file" accept="application/json,.json" onChange={(event)=>void restoreWorkspaceBackup(event)}/></label>
              </div>
            </div>
            <div className="workspace-info-banner"><ShieldCheck size={16}/><span>Yedekler işletme bilgilerini, notları, durumları, takip/izin tarihlerini ve arama geçmişini içerir. Çakışan kayıtlar korunur; içe aktarma mevcut kayıtları silmez.</span></div>
            {dueFollowUps.length > 0 && <section className="panel-card due-followups"><div className="card-title-row"><div><div className="eyebrow">BUGÜN VE GECİKMİŞ</div><h2>{dueFollowUps.length} takip hatırlatması</h2></div><History size={17} className="muted-icon"/></div><div className="due-followup-list">{dueFollowUps.slice(0, 5).map((record)=><button key={record.business.placeId} onClick={()=>openSavedBusiness(record)}><span>{record.business.name}</span><strong>{record.followUpAt?.slice(0,10)}</strong></button>)}</div></section>}
            {workspaceLoading ? <div className="history-empty">Kayıtlı işletmeler yükleniyor…</div> : businessRecords.length === 0 ? <section className="panel-card history-empty"><div className="empty-icon large"><Inbox size={22}/></div><strong>Henüz kayıtlı işletme yok</strong><span>Harita üzerinden arama yaptığında bulunan işletmeler otomatik kaydedilir.</span><button className="secondary-button" onClick={()=>setView("finder")}><Search size={14}/> İşletme ara</button></section> :
              <>
              <div className="saved-business-toolbar"><label><Search size={15}/><input aria-label="Kayıtlı işletmelerde ara" value={businessListFilter} onChange={(event)=>{setBusinessListFilter(event.target.value);setBusinessPage(0);}} placeholder="İşletme, e-posta, adres veya not ara..."/></label><span>{filteredBusinessRecords.length} kayıt · {currentBusinessPage+1}/{businessPageCount} sayfa</span></div>
              {filteredBusinessRecords.length === 0 ? <div className="panel-card history-empty"><strong>Aramana uygun işletme bulunamadı</strong><span>Filtreyi değiştirip tekrar dene.</span></div> :
              <div className="saved-business-list">{displayedBusinessRecords.map((record)=>{
                const id = record.business.placeId;
                const draft = businessDrafts[id] ?? {note:"",followUpAt:"",emailConsentSource:"",emailConsentDate:""};
                const isDue = Boolean(record.followUpAt && record.followUpAt.slice(0,10) <= new Date().toISOString().slice(0,10));
                return <article className="panel-card saved-business-card" key={id}>
                  <div className="saved-business-heading">
                    <div><div className="eyebrow">{record.business.category || "İŞLETME"} · {record.business.email ? "E-POSTA VAR" : "E-POSTA YOK"}</div><h2>{record.business.name}</h2><p>{record.business.address || "Adres bilgisi bulunamadı"}</p><small>{record.business.email || record.business.phone || record.business.website || id}</small></div>
                    <div className="saved-business-heading-actions">
                      {record.followUpAt && <span className={`follow-up-badge ${isDue?"due":""}`}>{isDue?"Takip zamanı geldi":"Takip tarihi"} · {record.followUpAt.slice(0,10)}</span>}
                      <button className="secondary-button compact" onClick={()=>openSavedBusiness(record)}><MapPin size={13}/> Haritada aç</button>
                    </div>
                  </div>
                  <div className="saved-business-fields">
                    <label>İşletme durumu<select value={record.status ?? ""} onChange={(event)=>{const value=event.target.value;setStatus(id,value==="green"||value==="yellow"||value==="red"?value:null);}}><option value="">Henüz işaretlenmedi</option><option value="green">Görüşüldü</option><option value="yellow">Potansiyel</option><option value="red">Anlaşılmadı</option></select></label>
                    <label>Bir sonraki takip tarihi<input type="date" value={draft.followUpAt} onChange={(event)=>setBusinessDrafts((current)=>({...current,[id]:{...draft,followUpAt:event.target.value}}))} onBlur={(event)=>void saveBusinessUpdate(id,{followUpAt:event.currentTarget.value||null})}/></label>
                    <label className="saved-business-note">Görüşme / takip notu<textarea rows={2} maxLength={5000} value={draft.note} onChange={(event)=>setBusinessDrafts((current)=>({...current,[id]:{...draft,note:event.target.value}}))} onBlur={(event)=>void saveBusinessUpdate(id,{note:event.currentTarget.value})} placeholder="Görüşme özeti veya sonraki adım..."/></label>
                    <label>İzin kaynağı<input maxLength={500} value={draft.emailConsentSource} onChange={(event)=>setBusinessDrafts((current)=>({...current,[id]:{...draft,emailConsentSource:event.target.value}}))} onBlur={(event)=>void saveBusinessUpdate(id,{emailConsentSource:event.currentTarget.value||null})} placeholder="Örn. web formu, telefon görüşmesi"/></label>
                    <label>İzin tarihi<input type="date" value={draft.emailConsentDate} onChange={(event)=>setBusinessDrafts((current)=>({...current,[id]:{...draft,emailConsentDate:event.target.value}}))} onBlur={(event)=>void saveBusinessUpdate(id,{emailConsentDate:event.currentTarget.value||null})}/></label>
                  </div>
                  {record.emailConsentSource || record.emailConsentDate ? <p className="consent-record-note"><ShieldCheck size={13}/> İzin kaydı: {record.emailConsentSource || "Kaynak belirtilmedi"} · {record.emailConsentDate || "Tarih belirtilmedi"}</p> : <p className="consent-record-note missing"><ShieldCheck size={13}/> İzin kaynağı/tarihi henüz kaydedilmedi. İleti göndermeden önce ilgili yükümlülükleri ayrıca doğrula.</p>}
                </article>;
              })}</div>}
              </>}
            {!workspaceLoading && filteredBusinessRecords.length > businessPageSize && <div className="business-pagination"><button className="secondary-button compact" disabled={currentBusinessPage===0} onClick={()=>setBusinessPage((page)=>Math.max(0,page-1))}>Önceki</button><span>{currentBusinessPage+1} / {businessPageCount}</span><button className="secondary-button compact" disabled={currentBusinessPage>=businessPageCount-1} onClick={()=>setBusinessPage((page)=>Math.min(businessPageCount-1,page+1))}>Sonraki</button></div>}
          </div>
        )}

        {view === "search-history" && (
          <div className="page-content">
            <div className="page-heading"><div><div className="eyebrow"><History size={14}/> KAYITLI ARAMALAR</div><h1>Arama geçmişi</h1><p>Önceki aramaların kayıtlı sonuçlarını aç; yeni Places araması yapılmaz.</p></div><button className="primary-button" onClick={()=>setView("finder")}><Search size={15}/> Yeni arama</button></div>
            <section className="search-history-list">
              {workspaceLoading ? <div className="history-empty">Arama geçmişi yükleniyor…</div> : searchHistory.length === 0 ? <div className="panel-card history-empty"><div className="empty-icon large"><Inbox size={22}/></div><strong>Henüz arama geçmişi yok</strong><span>Başarılı harita aramaları burada saklanır.</span><button className="secondary-button" onClick={()=>setView("finder")}><Search size={14}/> İşletme ara</button></div> : searchHistory.map((search)=><article className="panel-card search-history-item" key={search.id}><div><div className="eyebrow">{new Date(search.createdAt).toLocaleString("tr-TR")}</div><h2>{search.query || "Harita seçimi"}</h2><p>{search.category} · {search.radius >= 1000 ? `${search.radius/1000} km` : `${search.radius} m`} · {search.businessIds.length} işletme</p></div><button className="secondary-button compact" onClick={()=>openSavedSearch(search)}>Kayıtlı sonuçları aç <ArrowUpRight size={14}/></button></article>)}
            </section>
          </div>
        )}

        {view === "email" && (
          <div className="page-content">
            <div className="page-heading email-heading"><div><div className="eyebrow"><Mail size={14}/> İLETİŞİM</div><h1>E-posta gönder</h1><p>Şablonunu düzenle, değişkenlerle kişiselleştir ve izinli alıcılara gönder.</p></div><button className="secondary-button" onClick={() => setView("email-history")}><FileText size={15}/> Gönderim geçmişi</button></div>
            <div className={`smtp-banner ${smtpConfigured ? "ready" : "missing"}`}><div><ShieldCheck size={17}/></div><span><strong>{smtpConfigured ? "SMTP hazır" : "SMTP yapılandırması eksik"}</strong><small>{smtpConfigured ? "Gönderim sunucusu ayarlı. Önce kendi adresine test gönderimi yapman önerilir." : ".env.local dosyasına SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ve SMTP_FROM ekle; ardından sunucuyu yeniden başlat."}</small></span><span className="smtp-state">{smtpConfigured ? "BAĞLI" : "AYAR GEREKLİ"}</span></div>

            <div className="template-layout">
              <section className="panel-card template-editor">
                <div className="template-toolbar"><div><div className="eyebrow">MESAJ TASARIMI</div><h2>E-posta şablonu</h2></div><button className="secondary-button compact" onClick={createTemplate}><Plus size={14}/> Yeni</button></div>
                <div className="template-form-row"><label>Şablon seç<select value={templateDraft.id} onChange={(event) => {const found=emailTemplates.find((item)=>item.id===event.target.value);if(found)setTemplateDraft(found);}}>{emailTemplates.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label>Şablon adı<input value={templateDraft.name} maxLength={100} onChange={(event)=>updateTemplate("name",event.target.value)}/></label></div>
                <div className="template-form-row"><label>Gönderen adı<input value={templateDraft.fromName} maxLength={100} onChange={(event)=>updateTemplate("fromName",event.target.value)} placeholder="Örn. IBAYSOFT"/></label><label>Konu<input value={templateDraft.subject} maxLength={200} onChange={(event)=>updateTemplate("subject",event.target.value)} placeholder="{{business_name}} için teklif"/></label></div>
                <label className="template-text-label">E-posta içeriği<textarea value={templateDraft.body} maxLength={30000} rows={8} onChange={(event)=>updateTemplate("body",event.target.value)}/></label>
                <label className="template-text-label">İmza<textarea value={templateDraft.signature} maxLength={5000} rows={3} onChange={(event)=>updateTemplate("signature",event.target.value)}/></label>
                <div className="variable-area"><span>Kişiselleştirme değişkenleri — tıklayarak içeriğe ekle</span><div>{["business_name","business_email","business_phone","business_website","business_address","business_category"].map((variable)=><button type="button" className="variable-chip" key={variable} onClick={()=>updateTemplate("body",`${templateDraft.body} {{${variable}}}`)}>{`{{${variable}}}`}</button>)}</div></div>
                <button className="primary-button save-template" disabled={templateSaving || emailLoading} onClick={saveTemplate}><Save size={15}/>{templateSaving?"Kaydediliyor…":"Şablonu kaydet"}</button>
              </section>
              <section className="panel-card email-preview">
                <div className="eyebrow">CANLI ÖNİZLEME</div><h2>{interpolate(templateDraft.subject,previewRecipient)}</h2><div className="preview-meta"><span>Kimden</span><strong>{templateDraft.fromName} &lt;{smtpFrom || "SMTP_FROM"}&gt;</strong></div><div className="preview-meta"><span>Kime</span><strong>{previewRecipient?.email || "ornek@isletme.com"}</strong></div><div className="preview-content">{interpolate(templateDraft.body,previewRecipient)}<br/><br/>{interpolate(templateDraft.signature,previewRecipient)}</div><div className="preview-note">Önizleme seçili ilk alıcı bilgileriyle oluşturulur. SMTP adresi sadece gönderici adresidir.</div>
              </section>
            </div>

            <section className="panel-card recipient-card">
              <div className="recipient-header"><div><div className="eyebrow">ALICI SEÇİMİ</div><h2>Harita ve manuel alıcılar</h2><p>{visibleBusinesses.length} işletme bulundu · {recipients.length} gönderilebilir e-posta · {manualRecipients.length} manuel adres · en fazla 30 alıcı</p></div><div className="recipient-head-actions"><input className="recipient-filter" value={emailFilter} onChange={(event)=>setEmailFilter(event.target.value)} placeholder="Ara…"/><button className="secondary-button compact" disabled={emailRescanning || !visibleBusinesses.some((business)=>business.website&&!business.email)} onClick={()=>void rescanBusinesses()}>{emailRescanning?"Siteler taranıyor…":"Web sitelerini tekrar tara"}</button><button className="secondary-button compact" disabled={!recipients.length} onClick={()=>setSelectedRecipients([...selectedRecipients.filter((id)=>manualRecipients.some((recipient)=>recipient.id===id)), ...recipients.filter((business)=>!selectedRecipients.includes(business.placeId)).slice(0, Math.max(0, 30 - selectedRecipients.filter((id)=>manualRecipients.some((recipient)=>recipient.id===id)).length)).map((business)=>business.placeId)])}>İlk uygunları seç</button><button className="secondary-button compact" onClick={()=>setSelectedRecipients([])}>Temizle</button></div></div>
              <form className="manual-recipient-form" onSubmit={addManualRecipient}>
                <label>Manuel e-posta adresi<input type="email" required maxLength={254} value={manualRecipientEmail} onChange={(event)=>setManualRecipientEmail(event.target.value)} placeholder="ornek@firma.com"/></label>
                <label>Alıcı adı (isteğe bağlı)<input maxLength={200} value={manualRecipientName} onChange={(event)=>setManualRecipientName(event.target.value)} placeholder="İşletme veya kişi adı"/></label>
                <button className="secondary-button compact" type="submit" disabled={selectedRecipients.length >= 30}><Plus size={14}/> Alıcı ekle</button>
              </form>
              {manualRecipients.length > 0 && <div className="manual-recipient-list" aria-label="Manuel alıcılar">{manualRecipients.map((recipient)=><div className="email-row manual-email-row" key={recipient.id}><div className="email-business"><span className="status-dot neutral"/><div><strong>{recipient.name || "Manuel alıcı"}</strong><span>Manuel adres</span></div></div><span className="email-address">{recipient.email}</span><button type="button" className="secondary-button compact" onClick={()=>removeManualRecipient(recipient.id)}>Kaldır</button><input aria-label={`${recipient.email} alıcı olarak seç`} type="checkbox" checked={selectedRecipients.includes(recipient.id)} disabled={!selectedRecipients.includes(recipient.id)&&selectedRecipients.length>=30} onChange={()=>toggleRecipient(recipient.id)}/></div>)}</div>}
              {visibleBusinesses.length === 0 ? <div className="email-empty compact-empty"><div className="empty-icon large"><Inbox size={23}/></div><h2>Henüz işletme yok</h2><p>Önce İşletme Bul bölümünde bir konum ara.</p><button className="secondary-button" onClick={()=>setView("finder")}>İşletme ara <ArrowUpRight size={15}/></button></div> :
                emailCandidates.length === 0 ? <div className="email-empty compact-empty"><h2>Aramana uygun işletme bulunamadı</h2><p>Filtreyi temizleyip tekrar dene.</p></div> :
                <><div className="email-table-head"><span>İŞLETME</span><span>E-POSTA / DURUM</span><span>TEKRAR ARA</span><span>SEÇ</span></div><div className="recipient-rows">{emailCandidates.map((business)=><div className="email-row" key={business.placeId}><div className="email-business"><span className={`status-dot ${statuses[business.placeId]??"neutral"}`}/><div><strong>{business.name}</strong><span>{business.category}</span></div></div><span className="email-address" title={business.emailSearchMessage}>{business.email || (business.emailSearchStatus === "searching" ? "Resmî sitede aranıyor…" : business.emailSearchStatus === "partial" ? business.emailSearchMessage || "Siteye erişilemedi" : business.website ? "Resmî sitede bulunamadı" : "Web sitesi yok")}</span><button type="button" className="secondary-button compact" disabled={!business.website || business.emailSearchStatus === "searching"} onClick={()=>void retryEmailSearch(business)}>{business.emailSearchStatus === "searching" ? "Aranıyor…" : business.email ? "Yeniden ara" : "E-posta ara"}</button><input aria-label={`${business.name} alıcı olarak seç`} type="checkbox" checked={selectedRecipients.includes(business.placeId)} disabled={!business.email || statuses[business.placeId] === "red" || (!selectedRecipients.includes(business.placeId)&&selectedRecipients.length>=30)} onChange={()=>toggleRecipient(business.placeId)}/></div>)}</div></>}
              <div className="consent-row"><label><input type="checkbox" checked={consentConfirmed} onChange={(event)=>setConsentConfirmed(event.target.checked)}/><span>Seçtiğim alıcıların ticari ileti gönderimine izin verdiğini ve ret listemde olmadığını doğruluyorum.</span></label><span>{selectedEmailRecipients.length}/30 seçili</span></div>
              <div className="email-actions"><span><ShieldCheck size={15}/> İzin, KVKK/6563 ve İYS yükümlülüklerini kontrol et. SMTP kabulü teslimat garantisi değildir.</span><button className="primary-button" disabled={!selectedEmailRecipients.length||!consentConfirmed||!smtpConfigured||emailSending} onClick={sendEmail}>{emailSending?<><span className="button-spinner"/>Gönderiliyor…</>:<><Send size={15}/> {selectedEmailRecipients.length} kişiye gönder</>}</button></div>
            </section>
          </div>
        )}

        {view === "email-history" && (
          <div className="page-content">
            <div className="page-heading"><div><div className="eyebrow"><FileText size={14}/> GÖNDERİM KAYITLARI</div><h1>E-posta geçmişi</h1><p>Bu cihazda kaydedilen alıcı bazlı SMTP gönderim sonuçları.</p></div><div className="history-header-actions"><button className="secondary-button" disabled={historyRefreshing} onClick={()=>void refreshEmailHistory()}><RotateCw size={15} className={historyRefreshing?"button-spin-icon":""}/> Geçmişi yenile</button><button className="primary-button" onClick={()=>setView("email")}><Mail size={15}/> E-posta hazırla</button></div></div>
            <div className="history-summary"><div><strong>{emailHistory.filter((item)=>item.status==="sent").length}</strong><span>SMTP kabul etti</span></div><div><strong>{emailHistory.filter((item)=>item.status==="failed").length}</strong><span>Başarısız</span></div><div><strong>{emailHistory.filter((item)=>item.status==="skipped").length}</strong><span>Tekrar engellendi</span></div><div><strong>{emailHistory.length}</strong><span>Toplam kayıt</span></div></div>
            <section className="panel-card history-card">{emailLoading?<div className="history-empty">Geçmiş yükleniyor…</div>:emailHistory.length===0?<div className="history-empty"><div className="empty-icon large"><Inbox size={22}/></div><strong>Henüz gönderim kaydı yok</strong><span>SMTP gönderim denemeleri alıcı bazında burada saklanır.</span></div>:<><div className="history-table-head"><span>TARİH</span><span>İŞLETME / ALICI</span><span>KONU</span><span>DURUM</span></div><div className="history-rows">{emailHistory.map((entry)=><div className="history-row" key={entry.id}><span>{new Date(entry.createdAt).toLocaleString("tr-TR")}</span><div><strong>{entry.businessName}</strong><small>{entry.email}</small></div><span className="history-subject">{entry.subject}</span><div><span className={`history-status ${entry.status}`}>{entry.status==="sent"?"SMTP kabul etti":entry.status==="failed"?"Başarısız":"Atlandı"}</span><small>{entry.detail}</small></div></div>)}</div></>}</section>
            <p className="history-disclaimer"><ShieldCheck size={14}/> Geçmiş `.data/email-store.json` içinde bu makinede saklanır; gerçek teslimat/bounce durumunu Gmail veya alıcı sunucusu ayrıca bildirir.</p>
          </div>
        )}
      </section>
      {statusDetail && (
        <div className="status-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setStatusDetail(null);
        }}>
          <section className="status-dialog" role="dialog" aria-modal="true" aria-labelledby="status-dialog-title">
            <div className="status-dialog-header">
              <div>
                <div className="eyebrow">İŞLETME DURUMU</div>
                <h2 id="status-dialog-title">{statusDetails[statusDetail].title}</h2>
                <p>{statusDetails[statusDetail].description}</p>
              </div>
              <button className="icon-button" aria-label="Pencereyi kapat" onClick={() => setStatusDetail(null)}><X size={17} /></button>
            </div>
            {statusDetails[statusDetail].businesses.length > 0 ? (
              <div className="status-detail-list">
                {statusDetails[statusDetail].businesses.map((business) => {
                  const status = statuses[business.placeId] ?? null;
                  return (
                    <article className="status-detail-business" key={business.placeId}>
                      <div className="status-detail-title">
                        <div>
                          <strong>{business.name}</strong>
                          <span>{business.category || "İşletme"}</span>
                        </div>
                        <span className={`status-detail-badge ${status ?? "unclassified"}`}>
                          {status ? statusNames[status] : "Henüz değerlendirilmedi"}
                        </span>
                      </div>
                      <div className="status-detail-meta">
                        <span><MapPin size={13} />{business.address || "Adres bilgisi bulunamadı"}</span>
                        {business.phone && <span><Building2 size={13} />{business.phone}</span>}
                        {business.email && <span><Mail size={13} />{business.email}</span>}
                      </div>
                      <button className="secondary-button compact" onClick={() => {
                        const record = businessRecords.find((item) => item.business.placeId === business.placeId);
                        if (record) openSavedBusiness(record);
                        else {
                          setBusinesses((current) =>
                            current.some((item) => item.placeId === business.placeId)
                              ? current
                              : [...current, business],
                          );
                          setHidden((current) => current.filter((id) => id !== business.placeId));
                          setFocusedPlaceId(business.placeId);
                          setView("finder");
                        }
                        setStatusDetail(null);
                      }}>
                        <MapPin size={13} /> Haritada incele
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="status-detail-empty">
                <div className="empty-icon large"><Inbox size={22} /></div>
                <strong>{businessRecords.length ? "Bu durumda işletme yok" : "Henüz işletme aranmadı"}</strong>
                <p>{businessRecords.length
                  ? `Bu listeye yalnızca ${statusDetails[statusDetail].title} olarak işaretlediğin işletmeler eklenir. Henüz işaretlemediklerin burada gösterilmez.`
                  : "Haritada işletme ara; bulunan kayıtlar durumlarına göre burada görüntülenir."}</p>
                <button className="secondary-button" onClick={() => {
                  setView("finder");
                  setStatusDetail(null);
                }}>
                  <Search size={14} /> İşletme Bul
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {notice && <div role="status" className="toast"><Check size={16}/>{notice}<button onClick={() => setNotice("")}>Kapat</button></div>}
    </main>
  );
}

function StatCard({icon, label, value, note, accent, onClick}: {icon: React.ReactNode; label: string; value: number; note: string; accent: string; onClick: () => void}) {
  return <button type="button" className="stat-card" onClick={onClick} aria-label={`${label}: ${value}. İşletme listesini görüntüle`}>
    <span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong className="stat-value">{value.toLocaleString("tr-TR")}</strong><span className="stat-note">{note}</span>
    <span className="stat-open-hint">Listeyi görüntüle <ArrowUpRight size={12}/></span>
  </button>;
}

function BusinessCard({business, status, onStatus, onHide, onCopy, onShowMap}: {business: FoundBusiness; status: StatusColor; onStatus: (id:string,status:StatusColor)=>void; onHide:(id:string)=>void; onCopy:(email:string)=>void; onShowMap:()=>void}) {
  return <article className={`business-card ${status ?? "neutral"}`} onClick={onShowMap}>
    <div className="business-card-top"><div className="business-avatar">{business.name.slice(0,1).toLocaleUpperCase("tr-TR")}</div><div className="business-heading"><strong>{business.name}</strong><span>{business.category || "İşletme"}</span></div>{business.chainStatus === "chain" ? <span className="chain-badge" title="Bilinen zincir marka adıyla veya aynı adla birden fazla arama sonucu ile eşleşti; kesin şube sayısı değildir.">{business.chainBranchCount ? `Olası zincir · ${business.chainBranchCount} sonuç` : "Zincir marka"}</span> : <span className="chain-badge unknown" title="Mevcut arama verisi bağımsız olduğunu doğrulamaya yetmiyor.">Şube durumu belirsiz</span>}<button className="icon-button tiny" title="İşletmeyi gizle" onClick={(event) => {event.stopPropagation(); onHide(business.placeId);}}><EyeOff size={14}/></button></div>
    <div className="business-address"><MapPin size={13}/>{business.address || "Adres bilgisi bulunamadı"}</div>
    {business.rating && <div className="business-rating">★ {business.rating.toFixed(1)} <span>Google puanı</span></div>}
    <div className="business-actions" onClick={(event) => event.stopPropagation()}>
      <button className="map-focus-button" onClick={onShowMap}><MapPin size={13}/> Haritada göster</button>
      {business.email ? <button className="email-copy-button" onClick={() => onCopy(business.email!)}><Copy size={13}/> {business.email}</button> : <span className="no-email" title={business.emailSearchMessage}>{business.emailSearchStatus === "searching" ? "Resmî sitede aranıyor…" : business.emailSearchStatus === "partial" ? business.emailSearchMessage || "Siteye erişilemedi" : business.website ? "Resmî sitede bulunamadı" : "Web sitesi yok"}</span>}
    </div>
    <div className="status-control" onClick={(event) => event.stopPropagation()}><span>Durum</span>{(["red","yellow","green"] as const).map((value) => <button key={value} aria-label={statusNames[value]} title={statusNames[value]} className={`status-choice ${value} ${status===value?"selected":""}`} onClick={() => onStatus(business.placeId,status===value?null:value)}><i/>{statusNames[value]}</button>)}</div>
  </article>;
}
