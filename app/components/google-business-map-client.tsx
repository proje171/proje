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
  website?: string;
  phone?: string;
};

type Props = {
  businesses: FoundBusiness[];
  statuses: Record<string, "green" | "yellow" | "red" | null | undefined>;
  onResults: (results: FoundBusiness[]) => void;
  onSearching: (searching: boolean) => void;
  onNotice: (message: string) => void;
  externalQuery: string;
  externalCategory: string;
  externalRadius: number;
  searchNonce: number;
  locationNonce: number;
  focusedPlaceId: string | null;
};

const initialCenter = { lat: 41.0082, lng: 28.9784 };
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

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
  onSearching,
  onNotice,
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
        onNotice("Google Maps henüz yükleniyor. Birkaç saniye sonra tekrar dene.");
        return;
      }

      onSearching(true);
      setSelected(null);

      const execute = (location: google.maps.LatLng) => {
        const nextCenter = { lat: location.lat(), lng: location.lng() };
        setCenter(nextCenter);
        map.panTo(location);
        map.setZoom(14);

        const categoryText =
          externalCategory === "Tüm işletmeler" ? "işletme" : externalCategory;
        const query = searchText.trim()
          ? `${categoryText} ${searchText.trim()}`
          : `${categoryText} yakınlarda`;
        const service = new placesLibrary.PlacesService(map);

        service.textSearch(
          { query, location, radius: externalRadius },
          (results, status) => {
            onSearching(false);
            if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
              const message =
                status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS
                  ? "Bu konum ve yarıçap içinde işletme bulunamadı."
                  : status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT
                    ? "Google Places kotası doldu. Bir süre sonra tekrar dene."
                    : `Google Places araması başarısız oldu (${status}). API etkinliği ve faturalandırmayı kontrol et.`;
              onResults([]);
              onNotice(message);
              return;
            }

            const unique = new globalThis.Map<string, FoundBusiness>();
            for (const result of results) {
              const placeId = result.place_id;
              const position = result.geometry?.location;
              if (!placeId || !position) continue;
              unique.set(placeId, {
                placeId,
                name: result.name || "İsimsiz işletme",
                category:
                  externalCategory === "Tüm işletmeler"
                    ? (result.types?.[0]?.replaceAll("_", " ") ?? "İşletme")
                    : externalCategory,
                address: result.formatted_address || "",
                location: { lat: position.lat(), lng: position.lng() },
                rating: result.rating,
              });
            }
            const found = Array.from(unique.values());
            onResults(found);
            onNotice(`${found.length} gerçek Google Places sonucu bulundu.`);
          },
        );
      };

      if (!searchText.trim()) {
        execute(new google.maps.LatLng(center.lat, center.lng));
        return;
      }

      new google.maps.Geocoder().geocode({ address: searchText }, (results, status) => {
        const location = results?.[0]?.geometry.location;
        if (status !== "OK" || !location) {
          onSearching(false);
          onResults([]);
          onNotice("Konum bulunamadı. Şehir, ilçe veya adresi yeniden kontrol et.");
          return;
        }
        execute(location);
      });
    },
    [center, externalCategory, externalRadius, map, onNotice, onResults, onSearching, placesLibrary],
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
                path: google.maps.SymbolPath.CIRCLE,
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
