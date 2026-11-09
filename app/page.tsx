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
  Eye,
  EyeOff,
  Inbox,
  Mail,
  MapPin,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import GoogleBusinessMap, { type FoundBusiness } from "./components/google-business-map-client";

type View = "dashboard" | "finder" | "email";
type StatusColor = "green" | "yellow" | "red" | null;

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
  red: "Olumsuz",
};

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [businesses, setBusinesses] = useState<FoundBusiness[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StatusColor>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(5000);
  const [category, setCategory] = useState(categoryOptions[0]);
  const [notice, setNotice] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [locationNonce, setLocationNonce] = useState(0);
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);

  const visibleBusinesses = useMemo(
    () => businesses.filter((business) => !hidden.includes(business.placeId)),
    [businesses, hidden],
  );
  const recipients = useMemo(
    () => visibleBusinesses.filter((business) => business.email),
    [visibleBusinesses],
  );

  function setStatus(placeId: string, status: StatusColor) {
    setStatuses((current) => ({ ...current, [placeId]: status }));
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
  }

  function toggleRecipient(placeId: string) {
    setSelectedRecipients((current) =>
      current.includes(placeId)
        ? current.filter((id) => id !== placeId)
        : [...current, placeId],
    );
  }

  async function sendEmail() {
    if (!selectedRecipients.length) {
      setNotice("Önce e-posta adresi olan işletmeleri seçmelisin.");
      window.setTimeout(() => setNotice(""), 3200);
      return;
    }
    setNotice("Gönderim için SMTP ayarları ve bir mesaj şablonu gereklidir.");
    window.setTimeout(() => setNotice(""), 4000);
  }

  const greenCount = Object.values(statuses).filter((value) => value === "green").length;
  const yellowCount = Object.values(statuses).filter((value) => value === "yellow").length;
  const redCount = Object.values(statuses).filter((value) => value === "red").length;

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
          <button className={`nav-item ${view === "email" ? "active" : ""}`} onClick={() => setView("email")}>
            <Mail size={17} /> E-posta Gönder
            {recipients.length > 0 && <span className="nav-count">{recipients.length}</span>}
          </button>
          <button className="nav-item" onClick={() => setNotice("Haritada aradığın işletmeler bu çalışma oturumu boyunca listede tutulur.")}>
            <Building2 size={17} /> İşletmelerim
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
          <div className="breadcrumbs"><span>IBAYSOFT</span><span className="crumb-slash">/</span><strong>{view === "dashboard" ? "Genel Bakış" : view === "finder" ? "İşletme Bul" : "E-posta Gönder"}</strong></div>
          <div className="topbar-actions"><span className="live-indicator"><i /> Yerel çalışma alanı</span><button className="icon-button" aria-label="Yardım" onClick={() => setNotice("İşletme aramak için İşletme Bul bölümünden konum ve yarıçap seç.")}><CircleHelp size={17} /></button></div>
        </header>

        {view === "dashboard" && (
          <div className="page-content">
            <div className="page-heading">
              <div><div className="eyebrow"><Sparkles size={14} /> İŞ GELİŞTİRME MERKEZİ</div><h1>İşletmelerini keşfet.</h1><p>Gerçek arama sonuçlarını takip et, iletişim fırsatlarını düzenle.</p></div>
              <button className="primary-button" onClick={() => setView("finder")}><Search size={16} /> İşletme ara <ArrowUpRight size={15} /></button>
            </div>
            <div className="stats-grid">
              <StatCard icon={<Building2 size={17}/>} label="Bulunan işletme" value={businesses.length} note="Son harita araması" accent="blue" />
              <StatCard icon={<Mail size={17}/>} label="E-posta bulunan" value={recipients.length} note="Açıkça listelenen adresler" accent="violet" />
              <StatCard icon={<Users size={17}/>} label="Görüşüldü" value={greenCount} note="Senin işaretlemelerin" accent="green" />
              <StatCard icon={<Target size={17}/>} label="Potansiyel / olumsuz" value={yellowCount + redCount} note={`${yellowCount} potansiyel · ${redCount} olumsuz`} accent="amber" />
            </div>
            <div className="dashboard-grid">
              <section className="panel-card welcome-card">
                <div className="card-title-row"><div><div className="eyebrow">BAŞLANGIÇ</div><h2>İlk işletme aramanı yap</h2></div><div className="round-icon"><Compass size={19}/></div></div>
                <p>Bir şehir, mahalle veya adres ara; haritada bir noktaya dokun ya da mevcut konumunu kullan. Sonuçlar bu oturumda saklanır.</p>
                <button className="secondary-button" onClick={() => setView("finder")}>Haritadan keşfet <ArrowUpRight size={15}/></button>
              </section>
              <section className="panel-card breakdown-card">
                <div className="card-title-row"><div><div className="eyebrow">GERÇEK VERİ</div><h2>Arama özeti</h2></div><SlidersHorizontal size={17} className="muted-icon"/></div>
                {businesses.length === 0 ? <div className="empty-mini"><div className="empty-icon"><Inbox size={18}/></div><div><strong>Henüz arama yok</strong><span>İstatistikler arama yaptığında güncellenir.</span></div></div> :
                  <div className="summary-rows"><div><span>Görünür işletmeler</span><strong>{visibleBusinesses.length}</strong></div><div><span>Gizlenen işletmeler</span><strong>{hidden.length}</strong></div><div><span>E-posta adresi olan</span><strong>{recipients.length}</strong></div></div>}
              </section>
            </div>
            <div className="footnote"><ShieldCheck size={14}/> İstatistikler yalnızca bu oturumda Google Places üzerinden bulunan sonuçlara dayanır. Sahte/demo işletme verisi kullanılmaz.</div>
          </div>
        )}

        {view === "finder" && (
          <div className="finder-page">
            <div className="finder-heading"><div><div className="eyebrow"><MapPin size={13}/> KONUM TABANLI KEŞİF</div><h1>İşletme bul</h1><p>Konumu ara veya haritadan seç; sonuçlar yarıçap içinde aranır.</p></div><div className="result-pill"><span className="result-dot"/>{visibleBusinesses.length} işletme</div></div>
            <div className="search-toolbar">
              <label className="search-box"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {if(event.key === "Enter") setSearchNonce((nonce) => nonce + 1);}} placeholder="Şehir, mahalle veya adres ara..." /><button id="map-search-button" className="search-submit" disabled={searching} onClick={() => setSearchNonce((nonce) => nonce + 1)}>{searching ? "Aranıyor..." : "Ara"}</button></label>
              <label className="select-box"><SlidersHorizontal size={15}/><select value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="select-box"><Target size={15}/><select value={radius} onChange={(event) => setRadius(Number(event.target.value))}><option value={1000}>1 km</option><option value={2000}>2 km</option><option value={5000}>5 km</option><option value={10000}>10 km</option><option value={15000}>15 km</option></select></label>
              <button className="location-button" disabled={searching} onClick={() => setLocationNonce((nonce) => nonce + 1)}><MapPin size={15}/> Mevcut konum</button>
            </div>
            <div className="finder-layout">
              <div className="map-frame"><GoogleBusinessMap businesses={visibleBusinesses} statuses={statuses} onResults={updateSearchResults} onSearching={setSearching} onNotice={setNotice} externalQuery={query} externalCategory={category} externalRadius={radius} searchNonce={searchNonce} locationNonce={locationNonce} focusedPlaceId={focusedPlaceId} /></div>
              <section className="results-panel">
                <div className="results-header"><div><h2>Arama sonuçları</h2><span>{visibleBusinesses.length ? `${visibleBusinesses.length} işletme bulundu` : "Konumuna göre keşfet"}</span></div><button className="icon-button small" title="Sonuçları temizle" onClick={() => updateSearchResults([])}><EyeOff size={16}/></button></div>
                <div className="business-list">
                  {visibleBusinesses.length === 0 ? <div className="empty-results"><div className="empty-icon large"><MapPin size={22}/></div><strong>Henüz sonuç yok</strong><p>Konum yazıp Ara’ya bas veya haritada bir noktaya tıkla.</p><span>İşletme sonuçları Google Places API’den gelir.</span></div> :
                    visibleBusinesses.map((business) => <BusinessCard key={business.placeId} business={business} status={statuses[business.placeId] ?? null} onStatus={setStatus} onHide={hideBusiness} onCopy={copyEmail} onShowMap={() => setFocusedPlaceId(business.placeId)}/>)}
                </div>
                {hidden.length > 0 && <div className="hidden-footer"><Eye size={14}/> {hidden.length} gizli işletme <button onClick={() => setHidden([])}>Tümünü göster</button></div>}
              </section>
            </div>
          </div>
        )}

        {view === "email" && (
          <div className="page-content">
            <div className="page-heading email-heading"><div><div className="eyebrow"><Mail size={14}/> İLETİŞİM</div><h1>E-posta gönder</h1><p>Son harita aramasındaki herkese açık e-posta adreslerini seç.</p></div><button className="secondary-button" onClick={() => setView("finder")}><MapPin size={15}/> Harita aramasına dön</button></div>
            <div className="email-summary"><div className="email-summary-icon"><Mail size={19}/></div><div><strong>{recipients.length} e-posta adresi</strong><span>Son arama sonuçlarında herkese açık e-postası bulunan işletmeler</span></div><div className="email-summary-count">{selectedRecipients.length} seçili</div></div>
            <div className="panel-card email-list-card">
              {recipients.length === 0 ? <div className="email-empty"><div className="empty-icon large"><Inbox size={23}/></div><h2>Gönderim için uygun adres yok</h2><p>{businesses.length === 0 ? "Önce İşletme Bul bölümünde bir konum ara. Bulduğun işletmeler buraya aktarılır." : `${businesses.length} işletme bulundu, ancak bunların hiçbirinde herkese açık e-posta adresi yok.`}</p><p className="subtle-copy">Google Places e-posta adresi sağlamaz; uygulama yalnızca işletmenin herkese açık web sitesinde bulabildiği adresleri gösterir. Adres uydurulmaz.</p><button className="secondary-button" onClick={() => setView("finder")}>İşletme ara <ArrowUpRight size={15}/></button></div> :
                <><div className="email-table-head"><span>İŞLETME</span><span>E-POSTA</span><span>SEÇ</span></div>{recipients.map((business) => <label className="email-row" key={business.placeId}><div className="email-business"><span className={`status-dot ${statuses[business.placeId] ?? "neutral"}`}/><div><strong>{business.name}</strong><span>{business.category}</span></div></div><span className="email-address">{business.email}</span><input type="checkbox" checked={selectedRecipients.includes(business.placeId)} onChange={() => toggleRecipient(business.placeId)}/></label>)}</>}
            </div>
            <div className="email-actions"><span><ShieldCheck size={15}/> Yalnızca izinli, geçerli ve herkese açık adreslere gönder.</span><button className="primary-button" disabled={!selectedRecipients.length} onClick={sendEmail}><Mail size={15}/> Seçilenlere e-posta gönder</button></div>
          </div>
        )}
      </section>
      {notice && <div role="status" className="toast"><Check size={16}/>{notice}<button onClick={() => setNotice("")}>Kapat</button></div>}
    </main>
  );
}

function StatCard({icon, label, value, note, accent}: {icon: React.ReactNode; label: string; value: number; note: string; accent: string}) {
  return <section className="stat-card"><div className={`stat-icon ${accent}`}>{icon}</div><div className="stat-label">{label}</div><strong className="stat-value">{value.toLocaleString("tr-TR")}</strong><div className="stat-note">{note}</div></section>;
}

function BusinessCard({business, status, onStatus, onHide, onCopy, onShowMap}: {business: FoundBusiness; status: StatusColor; onStatus: (id:string,status:StatusColor)=>void; onHide:(id:string)=>void; onCopy:(email:string)=>void; onShowMap:()=>void}) {
  return <article className={`business-card ${status ?? "neutral"}`} onClick={onShowMap}>
    <div className="business-card-top"><div className="business-avatar">{business.name.slice(0,1).toLocaleUpperCase("tr-TR")}</div><div className="business-heading"><strong>{business.name}</strong><span>{business.category || "İşletme"}</span></div><button className="icon-button tiny" title="İşletmeyi gizle" onClick={(event) => {event.stopPropagation(); onHide(business.placeId);}}><EyeOff size={14}/></button></div>
    <div className="business-address"><MapPin size={13}/>{business.address || "Adres bilgisi bulunamadı"}</div>
    {business.rating && <div className="business-rating">★ {business.rating.toFixed(1)} <span>Google puanı</span></div>}
    <div className="business-actions" onClick={(event) => event.stopPropagation()}>
      <button className="map-focus-button" onClick={onShowMap}><MapPin size={13}/> Haritada göster</button>
      {business.email ? <button className="email-copy-button" onClick={() => onCopy(business.email!)}><Copy size={13}/> {business.email}</button> : <span className="no-email">E-posta bulunamadı</span>}
    </div>
    <div className="status-control" onClick={(event) => event.stopPropagation()}><span>Durum</span>{(["red","yellow","green"] as const).map((value) => <button key={value} aria-label={statusNames[value]} title={statusNames[value]} className={`status-choice ${value} ${status===value?"selected":""}`} onClick={() => onStatus(business.placeId,status===value?null:value)}><i/>{statusNames[value]}</button>)}</div>
  </article>;
}
