"use client";

import {
  APIProvider,
  Circle,
  InfoWindow,
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { MapMouseEvent } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useRef, useState } from "react";

export type FoundBusiness = {
  placeId: string;
  name: string;
  category: string;
  address: string;
  location: google.maps.LatLngLiteral;
  rating?: number;
  email?: string;
  emailSearchStatus?: "searching" | "not-found" | "partial";
  emailSearchMessage?: string;
  website?: string;
  phone?: string;
  chainStatus?: "chain" | "unknown";
  chainBranchCount?: number;
};

type Props = {
  businesses: FoundBusiness[];
  statuses: Record<string, "green" | "yellow" | "red" | null | undefined>;
  onResults: (results: FoundBusiness[]) => void;
  onEnriched: (
    placeId: string,
    email: string | undefined,
    scanStatus: "complete" | "partial",
    scanMessage?: string,
  ) => void;
  onSearching: (searching: boolean) => void;
  onNotice: (message: string) => void;
  onSearchError: (message: string) => void;
  externalQuery: string;
  externalCategory: string;
  externalRadius: number;
  searchNonce: number;
  locationNonce: number;
  focusedPlaceId: string | null;
};

const initialCenter = { lat: 41.0082, lng: 28.9784 };
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const searchBatchSize = 3;
const businessTypes = [
  "bakery",
  "bank",
  "bar",
  "beauty_salon",
  "book_store",
  "cafe",
  "car_dealer",
  "car_rental",
  "car_repair",
  "car_wash",
  "cell_phone_store",
  "clothing_store",
  "coffee_shop",
  "convenience_store",
  "dentist",
  "department_store",
  "doctor",
  "drugstore",
  "electronics_store",
  "florist",
  "furniture_store",
  "gas_station",
  "gift_shop",
  "grocery_store",
  "gym",
  "hair_salon",
  "hardware_store",
  "home_goods_store",
  "insurance_agency",
  "jewelry_store",
  "laundry",
  "lawyer",
  "lodging",
  "meal_delivery",
  "meal_takeaway",
  "movie_theater",
  "nail_salon",
  "pet_store",
  "pharmacy",
  "physiotherapist",
  "real_estate_agency",
  "restaurant",
  "shoe_store",
  "spa",
  "sports_club",
  "store",
  "supermarket",
  "travel_agency",
  "veterinary_care",
];
const categoryTypes: Record<string, string[]> = {
  Restoran: ["restaurant", "meal_delivery", "meal_takeaway", "bakery", "bar"],
  Kafe: ["cafe", "coffee_shop", "bakery"],
  Kuaför: ["hair_salon"],
  "Güzellik salonu": ["beauty_salon", "nail_salon", "spa"],
  Otel: ["lodging"],
  Market: ["supermarket", "grocery_store", "convenience_store"],
  Emlak: ["real_estate_agency"],
  "Spor salonu": ["gym", "sports_club"],
  "Diş kliniği": ["dentist"],
  "Oto servis": ["car_repair", "car_dealer", "car_rental", "car_wash", "gas_station"],
  Mobilya: ["furniture_store", "home_goods_store"],
  Giyim: ["clothing_store", "shoe_store", "department_store"],
  "E-ticaret": ["store", "shopping_mall"],
};
const fallbackCategoryQueries: Record<string, string[]> = {
  Restoran: ["restaurant", "bakery", "bar"],
  Kafe: ["cafe", "coffee shop", "bakery"],
  Kuaför: ["hair salon", "barber shop"],
  "Güzellik salonu": ["beauty salon", "nail salon", "spa"],
  Otel: ["hotel", "lodging"],
  Market: ["supermarket", "grocery store", "convenience store"],
  Emlak: ["real estate agency"],
  "Spor salonu": ["gym", "fitness center"],
  "Diş kliniği": ["dentist", "dental clinic"],
  "Oto servis": ["car repair", "car dealer", "gas station"],
  Mobilya: ["furniture store", "home goods store"],
  Giyim: ["clothing store", "shoe store", "department store"],
  "E-ticaret": ["store", "shopping mall"],
};
const fallbackAllQueries = [
  "restaurant",
  "cafe",
  "store",
  "supermarket",
  "shopping mall",
  "hotel",
  "gas station",
  "pharmacy",
];
const knownChainNames = [
  "a101", "bim", "şok", "migros", "carrefoursa", "macrocenter", "starbucks",
  "mcdonald", "burger king", "kfc", "popeyes", "domino", "pizza hut",
  "kahve dünyası", "gloria jeans", "watsons", "gratis", "rossmann", "lc waikiki",
  "defacto", "koton", "mavi", "teknosa", "mediamarkt", "koçtaş", "ikea",
  "opet", "shell", "petrol ofisi", "turkcell", "vodafone", "türk telekom",
];

function normalizeBusinessName(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("ı", "i")
    .replace(/[\s|–—-]+(?:şube|sube)?\s*#?\d+\b.*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function addChainIndicators(businesses: FoundBusiness[]): FoundBusiness[] {
  const counts = new globalThis.Map<string, number>();
  for (const business of businesses) {
    const key = normalizeBusinessName(business.name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return businesses.map((business) => {
    const normalizedName = normalizeBusinessName(business.name);
    const knownChain = knownChainNames.some((name) => {
      const brand = normalizeBusinessName(name);
      return normalizedName === brand || normalizedName.startsWith(`${brand} `) || normalizedName.includes(` ${brand} `);
    });
    const branchCount = counts.get(normalizedName) ?? 0;
    return {
      ...business,
      chainStatus: knownChain || branchCount > 1 ? "chain" : "unknown",
      chainBranchCount: branchCount > 1 ? branchCount : undefined,
    };
  });
}

function getGeocoderErrorMessage(status: google.maps.GeocoderStatusString): string {
  if (status === "REQUEST_DENIED") {
    return "Google adres araması reddedildi. Google Cloud Console’da faturalandırmayı etkinleştirip Geocoding API ve Places API (New) hizmetlerini aç; API anahtarının site kısıtlarını kontrol et.";
  }
  if (status === "OVER_QUERY_LIMIT") {
    return "Google adres arama kotası doldu. Google Cloud Console’daki Geocoding API kotalarını kontrol et.";
  }
  if (status === "ZERO_RESULTS") {
    return "Bu adres bulunamadı. Şehir, ilçe veya adres bilgisini kontrol edip yeniden dene.";
  }
  if (status === "INVALID_REQUEST") {
    return "Geçerli bir konum yazıp yeniden dene.";
  }
  return "Google adres araması başarısız oldu. İnternet bağlantısını, faturalandırmayı ve Geocoding API ayarlarını kontrol et.";
}

function getPlacesErrorDetails(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : "";
  return `${errorMessage} ${String(error ?? "")}`.trim();
}

function isFatalPlacesSearchError(error: unknown): boolean {
  return /resource_exhausted|quota|rate.?limit|invalid_argument|unsupported types?/i.test(
    getPlacesErrorDetails(error),
  );
}

function getSearchGridSize(radiusMeters: number): number {
  return Math.min(7, Math.max(3, Math.ceil(radiusMeters / 1000)));
}

function createSearchGrid(
  center: google.maps.LatLngLiteral,
  radiusMeters: number,
): google.maps.CircleLiteral[] {
  const searchGridSize = getSearchGridSize(radiusMeters);
  const latitudeRadius = radiusMeters / 111_320;
  const longitudeRadius =
    radiusMeters / (111_320 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
  const south = center.lat - latitudeRadius;
  const west = center.lng - longitudeRadius;
  const latitudeStep = (latitudeRadius * 2) / searchGridSize;
  const longitudeStep = (longitudeRadius * 2) / searchGridSize;
  const tiles: google.maps.CircleLiteral[] = [];

  for (let row = 0; row < searchGridSize; row += 1) {
    for (let column = 0; column < searchGridSize; column += 1) {
      const tileCenter = {
        lat: south + latitudeStep * (row + 0.5),
        lng: west + longitudeStep * (column + 0.5),
      };
      const tileHeight = latitudeStep * 111_320;
      const tileWidth =
        longitudeStep *
        111_320 *
        Math.max(Math.cos((tileCenter.lat * Math.PI) / 180), 0.01);
      tiles.push({
        center: tileCenter,
        radius: Math.hypot(tileHeight, tileWidth) / 2,
      });
    }
  }
  return tiles;
}

async function enrichOfficialWebsites(
  businesses: FoundBusiness[],
  onEnriched: Props["onEnriched"],
  onNotice: Props["onNotice"],
) {
  const eligible = businesses.filter((business) => business.website);
  if (!eligible.length) {
    onNotice("İşletmeler bulundu; Google Places sonuçlarında taranabilir resmî web sitesi yok.");
    return;
  }

  try {
    for (let index = 0; index < eligible.length; index += 4) {
      const batch = eligible.slice(index, index + 4);
      const response = await fetch("/api/business-enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businesses: batch.map(({ placeId, website }) => ({ placeId, website })),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        results?: {
          placeId: string;
          emails: string[];
          scanStatus: "complete" | "partial";
          scanMessage?: string;
        }[];
      };
      if (!response.ok || !data.ok || !Array.isArray(data.results)) {
        throw new Error(data.error || "Resmî web sitesi taraması tamamlanamadı.");
      }
      for (const result of data.results) {
        onEnriched(result.placeId, result.emails[0], result.scanStatus, result.scanMessage);
      }
    }

    onNotice("Resmî web sitesi taraması tamamlandı. Yalnızca sayfalarda açıkça yayımlanan adresler eklendi.");
  } catch (error) {
    console.error("Business public email enrichment failed:", error);
    for (const business of eligible) {
      onEnriched(business.placeId, undefined, "partial");
    }
    onNotice(error instanceof Error ? error.message : "E-posta taraması tamamlanamadı.");
  }
}

export default function GoogleBusinessMap(props: Props) {
  if (!apiKey) {
    return (
      <div className="map-setup">
        <div className="map-setup-icon">!</div>
        <strong>Google Maps API anahtarı gerekli</strong>
        <p>
          <code>.env.local</code> içine NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ekleyip
          geliştirme sunucusunu yeniden başlat.
        </p>
      </div>
    );
  }

    return (
    <APIProvider apiKey={apiKey} libraries={["places"]}>
      <MapCanvas {...props} />
    </APIProvider>
  );
}

function MapCanvas({
  businesses,
  statuses,
  onResults,
  onEnriched,
  onSearching,
  onNotice,
  onSearchError,
  externalQuery,
  externalCategory,
  externalRadius,
  searchNonce,
  locationNonce,
  focusedPlaceId,
}: Props) {
  const map = useMap();
  const placesLibrary = useMapsLibrary("places");
  const [center, setCenter] = useState(initialCenter);
  const [selected, setSelected] = useState<FoundBusiness | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const previousSearch = useRef(0);
  const previousLocation = useRef(0);

  useEffect(() => {
    if (!map) return;
    const timer = window.setTimeout(() => setLoadingMap(false), 350);
    return () => window.clearTimeout(timer);
  }, [map]);

  const runSearch = useCallback(
    (searchText: string) => {
      if (!map || !placesLibrary) {
        const message = "Google Maps henüz yükleniyor. Birkaç saniye sonra tekrar dene.";
        onSearchError(message);
        onNotice(message);
        return;
      }

      onSearchError("");
      onSearching(true);
      setSelected(null);

      const execute = async (location: google.maps.LatLng) => {
        const nextCenter = { lat: location.lat(), lng: location.lng() };
        setCenter(nextCenter);
        map.panTo(location);
        map.setZoom(14);

        const includedTypes = categoryTypes[externalCategory] ?? businessTypes;
        try {
          const unique = new globalThis.Map<string, FoundBusiness>();
          const tiles = createSearchGrid(nextCenter, externalRadius);
          let failedTiles = 0;
          let firstTileError: unknown;
          let fatalSearchError: unknown;
          for (let index = 0; index < tiles.length; index += searchBatchSize) {
            const batch = tiles.slice(index, index + searchBatchSize);
            const batchResults = await Promise.all(
              batch.map(async (locationRestriction) => {
                try {
                  const result = await placesLibrary.Place.searchNearby({
                    fields: [
                      "id",
                      "displayName",
                      "formattedAddress",
                      "location",
                      "rating",
                      "types",
                      "websiteURI",
                      "nationalPhoneNumber",
                    ],
                    locationRestriction,
                    includedTypes,
                    rankPreference: "DISTANCE",
                    maxResultCount: 20,
                    language: "tr",
                    region: "TR",
                  });
                  return result.places;
                } catch (error) {
                  failedTiles += 1;
                  firstTileError ??= error;
                  if (isFatalPlacesSearchError(error)) fatalSearchError ??= error;
                  console.error("Google Places search tile failed:", error);
                  return [];
                }
              }),
            );

            for (const places of batchResults) {
              for (const place of places) {
                const placeId = place.id;
                const position = place.location;
                if (!placeId || !position) continue;
                const placeLocation = { lat: position.lat(), lng: position.lng() };
                if (distanceMeters(nextCenter, placeLocation) > externalRadius) continue;
                unique.set(placeId, {
                  placeId,
                  name: place.displayName || "İsimsiz işletme",
                  category:
                    externalCategory === "Tüm işletmeler"
                      ? (place.types?.find((type) => includedTypes.includes(type))?.replaceAll("_", " ") ?? "İşletme")
                      : externalCategory,
                  address: place.formattedAddress || "",
                  location: placeLocation,
                  rating: place.rating ?? undefined,
                  website: place.websiteURI ?? undefined,
                  phone: place.nationalPhoneNumber ?? undefined,
                });
              }
            }
            if (fatalSearchError) throw fatalSearchError;
          }
          if (failedTiles === tiles.length) {
            throw firstTileError ?? new Error("Google Places alt-bölge sorgularının tamamı başarısız oldu.");
          }
          const found = addChainIndicators(Array.from(unique.values())).map((business) => ({
            ...business,
            emailSearchStatus: business.website ? "searching" as const : undefined,
          }));
          onResults(found);
          if (!found.length && failedTiles > 0) {
            const message = `İşletme sonuçları alınamadı (${failedTiles} sorgu başarısız). ${getPlacesErrorMessage(firstTileError)}`;
            onSearchError(message);
            onNotice(message);
            return;
          }
          onNotice(
            found.length
              ? `${found.length} farklı işletme bulundu (${tiles.length} alt bölge tarandı${failedTiles ? `, ${failedTiles} sorgu başarısız` : ""}). Resmî web sitelerinde e-posta aranıyor.`
              : "Bu konum ve yarıçap içinde işletme bulunamadı.",
          );
          void enrichOfficialWebsites(found, onEnriched, onNotice);
        } catch (error) {
          console.error("Google Places API (New) search failed:", error);
          if (/resource_exhausted|quota|rate.?limit/i.test(getPlacesErrorDetails(error))) {
            const fallbackQueries =
              fallbackCategoryQueries[externalCategory] ?? fallbackAllQueries;
            const fallbackBusinessesById = new globalThis.Map<string, FoundBusiness>();
            try {
              for (const textQuery of fallbackQueries) {
                const fallback = await placesLibrary.Place.searchByText({
                  textQuery,
                  fields: [
                    "id",
                    "displayName",
                    "formattedAddress",
                    "location",
                    "rating",
                    "types",
                    "websiteURI",
                    "nationalPhoneNumber",
                  ],
                  locationBias: { center: nextCenter, radius: externalRadius },
                  rankPreference: "DISTANCE",
                  maxResultCount: 20,
                  language: "tr",
                  region: "TR",
                });
                for (const place of fallback.places) {
                  if (!place.id || !place.location) continue;
                  const location = { lat: place.location.lat(), lng: place.location.lng() };
                  if (distanceMeters(nextCenter, location) > externalRadius) continue;
                  fallbackBusinessesById.set(place.id, {
                    placeId: place.id,
                    name: place.displayName || "İsimsiz işletme",
                    category:
                      externalCategory === "Tüm işletmeler"
                        ? (place.types?.[0]?.replaceAll("_", " ") ?? "İşletme")
                        : externalCategory,
                    address: place.formattedAddress || "",
                    location,
                    rating: place.rating ?? undefined,
                    website: place.websiteURI ?? undefined,
                    phone: place.nationalPhoneNumber ?? undefined,
                  });
                }
              }
              const fallbackBusinesses = addChainIndicators(
                Array.from(fallbackBusinessesById.values()),
              ).map((business) => ({
                ...business,
                emailSearchStatus: business.website ? "searching" as const : undefined,
              }));
              onResults(fallbackBusinesses);
              if (fallbackBusinesses.length) {
                onSearchError("");
                onNotice(
                  `Yakındaki arama kotası dolduğu için ${fallbackQueries.length} metin sorgusuyla yedek arama yapıldı: ${fallbackBusinesses.length} farklı işletme bulundu.`,
                );
                void enrichOfficialWebsites(fallbackBusinesses, onEnriched, onNotice);
                return;
              }
              const message = `${getPlacesErrorMessage(error)} ${fallbackQueries.length} metin sorgusu da bu yarıçapta sonuç bulamadı.`;
              onSearchError(message);
              onNotice(message);
              return;
            } catch (fallbackError) {
              console.error("Google Places text-search fallback failed:", fallbackError);
              const partialFallbackBusinesses = addChainIndicators(
                Array.from(fallbackBusinessesById.values()),
              ).map((business) => ({
                ...business,
                emailSearchStatus: business.website ? "searching" as const : undefined,
              }));
              onResults(partialFallbackBusinesses);
              if (partialFallbackBusinesses.length) {
                const message = `Yedek arama kotaya takıldığı için kısmi sonuç gösteriliyor: ${partialFallbackBusinesses.length} işletme. ${getPlacesErrorMessage(fallbackError)}`;
                onSearchError("");
                onNotice(message);
                void enrichOfficialWebsites(partialFallbackBusinesses, onEnriched, onNotice);
                return;
              }
              const message = `${getPlacesErrorMessage(error)} Yedek metin araması da başarısız: ${getPlacesErrorMessage(fallbackError)}`;
              onResults([]);
              onSearchError(message);
              onNotice(message);
              return;
            }
          }
          onResults([]);
          const message = getPlacesErrorMessage(error);
          onSearchError(message);
          onNotice(message);
        } finally {
          onSearching(false);
        }
      };

      if (!searchText.trim()) {
        execute(new google.maps.LatLng(center.lat, center.lng));
        return;
      }

      function distanceMeters(
        first: google.maps.LatLngLiteral,
        second: google.maps.LatLngLiteral,
      ): number {
        const radians = (degrees: number) => (degrees * Math.PI) / 180;
        const latitudeDelta = radians(second.lat - first.lat);
        const longitudeDelta = radians(second.lng - first.lng);
        const haversine =
          Math.sin(latitudeDelta / 2) ** 2 +
          Math.cos(radians(first.lat)) *
            Math.cos(radians(second.lat)) *
            Math.sin(longitudeDelta / 2) ** 2;
        return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
      }

      function getPlacesErrorMessage(error: unknown): string {
        const message = getPlacesErrorDetails(error);
        if (/billing/i.test(message)) {
          return "Google Maps Platform faturalandırması etkin değil. Google Cloud Console’da projeye faturalandırma hesabı bağla; Places API (New) ve Geocoding API’yi etkinleştir.";
        }
        if (/resource_exhausted|quota|rate.?limit/i.test(message)) {
          return "Google Places günlük arama kotası doldu. Google Cloud Console > Places API (New) > Kotalar bölümünde Search Nearby istek/günlük kotasını artır veya günlük sıfırlanmasını bekle.";
        }
        const unsupportedTypes = message.match(/unsupported types?:\s*([^\n.]+)/i)?.[1];
        if (unsupportedTypes) {
          return `Google Places bu aramada desteklenmeyen işletme türü döndürdü: ${unsupportedTypes}. Arama türleri listesi güncellenmeli.`;
        }
        if (/invalid_argument/i.test(message)) {
          return "Google Places arama isteğinin parametrelerini reddetti. Arama bölgesi ve işletme türü filtrelerini kontrol et.";
        }
        if (/request_denied|permission.?denied|not authorized|api.?key|denied/i.test(message)) {
          return "Google Places API (New) isteği reddedildi. Google Cloud’da faturalandırma, Places API (New) ve API anahtarının HTTP referrer/API kısıtlarını kontrol et.";
        }
        return "Google Places API (New) araması başarısız oldu. Google Cloud’da faturalandırmayı, Places API (New) erişimini ve kota ayarlarını kontrol et.";
      }

      new google.maps.Geocoder().geocode({ address: searchText }, (results, status) => {
        const location = results?.[0]?.geometry.location;
        if (status !== "OK" || !location) {
          onSearching(false);
          onResults([]);
          const message = getGeocoderErrorMessage(status);
          onSearchError(message);
          onNotice(message);
          return;
        }
        execute(location);
      });
    },
    [center, externalCategory, externalRadius, map, onEnriched, onNotice, onResults, onSearchError, onSearching, placesLibrary],
  );

  useEffect(() => {
    if (searchNonce === 0 || searchNonce === previousSearch.current) return;
    previousSearch.current = searchNonce;
    runSearch(externalQuery);
  }, [externalQuery, runSearch, searchNonce]);

  useEffect(() => {
    if (locationNonce === 0 || locationNonce === previousLocation.current) return;
    previousLocation.current = locationNonce;
    if (!navigator.geolocation) {
      onNotice("Bu tarayıcı konum bilgisini desteklemiyor.");
      return;
    }

    onSearching(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onSearching(false);
        const nextCenter = { lat: coords.latitude, lng: coords.longitude };
        setCenter(nextCenter);
        map?.panTo(nextCenter);
        map?.setZoom(15);
        onNotice("Mevcut konum seçildi. İşletmeleri bulmak için Ara’ya bas.");
      },
      (error) => {
        onSearching(false);
        onNotice(
          error.code === error.PERMISSION_DENIED
            ? "Konum izni reddedildi. Tarayıcı ayarlarından konum iznini aç."
            : "Mevcut konum alınamadı. Konum servislerini kontrol et.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [locationNonce, map, onNotice, onSearching]);

  useEffect(() => {
    if (!focusedPlaceId || !map) return;
    const business = businesses.find((item) => item.placeId === focusedPlaceId);
    if (!business) return;
    map.panTo(business.location);
    map.setZoom(17);
  }, [businesses, focusedPlaceId, map]);

  function selectMapLocation(event: MapMouseEvent) {
    const point = event.detail.latLng;
    if (!point) return;
    const nextCenter = { lat: point.lat, lng: point.lng };
    setCenter(nextCenter);
    map?.panTo(nextCenter);
    setSelected(null);
    onSearchError("");
    onNotice("Haritada arama merkezi seçildi. İşletmeleri bulmak için Ara’ya bas.");
  }

  const popupBusiness =
    selected ??
    (focusedPlaceId
      ? businesses.find((business) => business.placeId === focusedPlaceId) ?? null
      : null);

  return (
    <div className="google-map-wrap">
      {loadingMap && <div className="map-loading">Harita yükleniyor…</div>}
      <Map
        className="google-map"
        defaultCenter={initialCenter}
        defaultZoom={12}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID"}
        gestureHandling="greedy"
        onClick={selectMapLocation}
        clickableIcons={false}
      >
        <Circle
          center={center}
          radius={externalRadius}
          fillColor="#4F7CFF"
          fillOpacity={0.08}
          strokeColor="#7395FF"
          strokeOpacity={0.65}
          strokeWeight={1.5}
          clickable={false}
        />
        <Marker position={center} title="Arama merkezi" />
        {businesses.map((business) => {
          const color =
            statuses[business.placeId] === "green"
              ? "#22c55e"
              : statuses[business.placeId] === "yellow"
                ? "#eab308"
                : statuses[business.placeId] === "red"
                  ? "#ef4444"
                  : "#778199";
          return (
            <Marker
              key={business.placeId}
              position={business.location}
              title={business.name}
              icon={{
                path: typeof google !== "undefined" && google.maps?.SymbolPath?.CIRCLE !== undefined
                  ? google.maps.SymbolPath.CIRCLE
                  : "M 0,0 m -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0",
                fillColor: color,
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
                scale: 8,
              }}
              onClick={() => setSelected(business)}
            />
          );
        })}
        {popupBusiness && (
          <InfoWindow position={popupBusiness.location} onCloseClick={() => setSelected(null)}>
            <div className="map-info-window">
              <strong>{popupBusiness.name}</strong>
              <span>{popupBusiness.address || "Adres bilgisi bulunamadı"}</span>
            </div>
          </InfoWindow>
        )}
      </Map>
      <div className="map-hint"><span className="map-hint-pin">●</span> Haritaya tıklayarak arama merkezi seç</div>
    </div>
  );
}
