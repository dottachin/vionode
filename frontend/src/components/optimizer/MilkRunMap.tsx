'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import 'leaflet/dist/leaflet.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

import type { Site } from '@/types/site';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Map as MapIcon, Route as RouteIcon } from 'lucide-react';

import * as flexModule from '@here/flexpolyline';

// ---- Minimal typings for @here/flexpolyline’s various export shapes ----
type FlexPolylineDecoder =
  | ((encoded: string) => unknown)
  | { decode?: (encoded: string) => unknown };

const flexNs = flexModule as unknown as { decode?: (e: string) => unknown } | undefined;
const flexDefault = (flexModule as unknown as { default?: FlexPolylineDecoder })?.default;

// ---------------------------------- Utils ----------------------------------

/** Read HERE API key from Vite or Next safely (return null if missing to allow graceful fallback) */
function getHereApiKey(): string | null {
  // Next.js public env via process.env
  const fromProcess =
    typeof process !== 'undefined' &&
    (process as unknown as { env?: Record<string, string | undefined> }).env?.NEXT_PUBLIC_HERE_API_KEY;

  // Vite or Next public env via import.meta
  const fromImportMeta =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env &&
    (((import.meta as any).env.VITE_HERE_API_KEY as string | undefined) ||
      ((import.meta as any).env.NEXT_PUBLIC_HERE_API_KEY as string | undefined));

  return fromProcess || fromImportMeta || null;
}

/** small preview helper for logs */
function preview(s: string, n = 24) {
  const head = s.slice(0, n);
  const tail = s.slice(-n);
  return `len=${s.length} head="${head}" tail="${tail}"`;
}

/** Classic Google/encoded polyline decoder (fallback) */
function decodeGooglePolyline(str: string, precision = 5): [number, number][] {
  let index = 0;
  const len = str.length;
  const coords: [number, number][] = [];
  let lat = 0,
    lng = 0;

  const read = () => {
    let b: number,
      shift = 0,
      result = 0;
    do {
      if (index >= len) throw new Error('encoded: varint unterminated');
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (shift > 30) throw new Error('encoded: varint too long');
    } while (b >= 0x20);
    return (result & 1) ? ~(result >> 1) : result >> 1;
  };

  while (index < len) {
    lat += read();
    lng += read();
    coords.push([lat / Math.pow(10, precision), lng / Math.pow(10, precision)]);
  }
  return coords;
}

/** Normalize whatever @here/flexpolyline returns into [lat, lng][] */
function normalizeFlexOutput(out: unknown): [number, number][] {
  // number[][]
  if (Array.isArray(out) && Array.isArray(out[0])) {
    return (out as number[][]).map((p) => [p[0], p[1]]);
  }
  // { polyline: number[][] }
  if (out && typeof out === 'object' && Array.isArray((out as { polyline?: number[][] }).polyline)) {
    return ((out as { polyline: number[][] }).polyline).map((p) => [p[0], p[1]]);
  }
  // [{lat,lng}]
  if (
    Array.isArray(out) &&
    typeof out[0] === 'object' &&
    out[0] !== null &&
    'lat' in (out[0] as Record<string, unknown>) &&
    'lng' in (out[0] as Record<string, unknown>)
  ) {
    return (out as Array<{ lat: number; lng: number }>).map((p) => [p.lat, p.lng]);
  }
  throw new Error('Unknown flexpolyline output shape');
}

/** Decode HERE flexible polyline via @here/flexpolyline; try all export forms; fallback to Google encoded */
function decodeHerePolyline(encoded: string): [number, number][] {
  let lastErr: unknown = null;

  try {
    if (flexNs?.decode) return normalizeFlexOutput(flexNs.decode(encoded));
  } catch (e) {
    lastErr = e;
  }
  try {
    if (typeof flexDefault === 'function') return normalizeFlexOutput(flexDefault(encoded));
  } catch (e) {
    lastErr = e;
  }
  try {
    if (flexDefault && typeof (flexDefault as { decode?: (x: string) => unknown }).decode === 'function') {
      return normalizeFlexOutput((flexDefault as { decode: (x: string) => unknown }).decode(encoded));
    }
  } catch (e) {
    lastErr = e;
  }

  // Fallback to Google encoded
  try {
    return decodeGooglePolyline(encoded, 5);
  } catch (e) {
    console.error(
      '[decodeHerePolyline] flexible + encoded fallback both failed.',
      '\nflex/last error:',
      lastErr,
      '\nencoded error:',
      e,
      '\npreview:',
      preview(encoded)
    );
    throw new Error('Failed to decode HERE polyline');
  }
}

/** Stronger numeric guard */
function isFiniteCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** helpers: display labels */
type VehicleLike = { id?: string | number; label?: string; name?: string; code?: string; registration?: string } & Record<string, any>;
type DriverLike = { id?: string | number; name?: string; full_name?: string; first_name?: string; last_name?: string } & Record<string, any>;

function getVehicleLabel(v?: VehicleLike) {
  if (!v) return undefined;
  return v.label ?? v.name ?? v.registration ?? v.code ?? undefined;
}
function getDriverName(d?: DriverLike) {
  if (!d) return undefined;
  return d.name ?? d.full_name ?? ((d.first_name || d.last_name) ? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() : undefined);
}
function getSiteName(s?: any) {
  if (!s) return undefined;
  return s.name ?? s.site_name ?? s.title ?? s.label ?? undefined;
}

/* ====================== Browser HERE routing with truck params ====================== */

type TruckOpts = { grossWeight?: number; hazardousGoods?: string[] };

type FetchHereOpts = {
  transportMode?: 'car' | 'truck' | 'scooter' | 'bicycle' | 'pedestrian';
  routingMode?: 'fast' | 'short';
  departureTimeISO?: string;
  truck?: TruckOpts;
};

/** HERE Router v8 (returns [] to signal fallback line if no key / fails) */
async function fetchHereRoute(
  points: [number, number][],
  signal?: AbortSignal,
  opts?: FetchHereOpts
): Promise<[number, number][]> {
  if (points.length < 2) return [];
  const apiKey = getHereApiKey();
  if (!apiKey) return []; // graceful fallback: draw straight dashed polyline

  const transportMode = opts?.transportMode ?? 'truck';
  const routingMode = opts?.routingMode ?? 'fast';

  const origin = points[0];
  const destination = points[points.length - 1];
  const vias = points.slice(1, -1);

  const params = new URLSearchParams({
    transportMode,
    origin: `${origin[0]},${origin[1]}`,
    destination: `${destination[0]},${destination[1]}`,
    return: 'polyline',
    routingMode,
    polylineFormat: 'flexible',
    apikey: apiKey,
  });
  if (opts?.departureTimeISO) params.set('departureTime', opts.departureTimeISO);

  // Truck params to match backend matrix behavior
  if (opts?.truck?.grossWeight) params.append('truck[grossWeight]', String(opts.truck.grossWeight));
  if (opts?.truck?.hazardousGoods?.length) {
    for (const hg of opts.truck.hazardousGoods) params.append('truck[hazardousGoods]', hg);
  }

  for (const [lat, lng] of vias) params.append('via', `${lat},${lng}`);

  const url = `https://router.hereapi.com/v8/routes?${params.toString()}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    // let caller draw fallback line
    return [];
  }

  const data = (await res.json()) as {
    routes?: Array<{ sections?: Array<{ polyline?: string }> }>;
  };
  const sections = data?.routes?.[0]?.sections ?? [];
  if (!sections.length) return [];

  const merged: [number, number][] = [];
  for (let i = 0; i < sections.length; i++) {
    const enc = sections[i]?.polyline;
    if (!enc) continue;
    try {
      const seg = decodeHerePolyline(enc);
      for (const pt of seg) {
        const last = merged[merged.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) merged.push(pt);
      }
    } catch {
      return []; // fallback
    }
  }

  return merged;
}

// Small concurrency limiter so you don’t hammer HERE
async function pMapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return ret;
}

// --------------------------------- Component --------------------------------

interface Props {
  depot?: Site;
  /** Accept array or map of sites */
  sites: Site[] | Record<string, Site>;
  /** Optional vehicle and driver to show names instead of IDs */
  vehicle?: VehicleLike;
  driver?: DriverLike;
  /** Optional: truck params to mirror backend behavior */
  truck?: TruckOpts;
  /** Optional routing options (defaults truck/fast) */
  transportMode?: 'car' | 'truck' | 'scooter' | 'bicycle' | 'pedestrian';
  routingMode?: 'fast' | 'short';
  departureTimeISO?: string;
  /** Optional: force remount when parent context changes */
  mapKey?: string;
  /** Optional: custom color for line + pins */
  color?: string;
}

const DEFAULT_CENTER: [number, number] = [46.603354, 1.888334]; // France
const DEFAULT_ZOOM = 6;

function FitToPoints({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (points.length >= 2) {
      const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [24, 24] });
    } else if (points.length === 1) {
      map.setView(points[0], 10);
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [map, points]);
  return null;
}

/** Create a home depot marker using inline SVG */
function makeDepotIcon(color = '#4f46e5'): L.DivIcon {
  const { base, highlight } = pinShades(color);
  const gradientId = `depot-g-${Math.random().toString(36).slice(2, 8)}`;
  const size = 36;
  const anchorX = size / 2;
  const anchorY = size - 2;

  const html = `
    <div style="transform: translate3d(0,0,0);">
      <svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity="0.35"/>
          </filter>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${highlight}" />
            <stop offset="100%" stop-color="${base}" stop-opacity="0.95"/>
          </linearGradient>
        </defs>
        <!-- Pin -->
        <path filter="url(#shadow)"
          d="M24 2C14.058 2 6 10.058 6 20c0 10.5 11.2 19.9 16.7 24.1a2 2 0 0 0 2.6 0C30.8 39.9 42 30.5 42 20 42 10.058 33.942 2 24 2Z"
          fill="url(#${gradientId})"/>
        <!-- Inner circle -->
        <circle cx="24" cy="19.5" r="9" fill="white"/>
        <!-- Home glyph -->
        <g transform="translate(16,14)" fill="#111827">
          <path d="M0 10 L8 -0.5 L16 10 L14 10 L14 16 L2 16 L2 10 Z" />
          <rect x="6.5" y="11" width="3" height="5" fill="white"/>
        </g>
      </svg>
    </div>
  `;
  return L.divIcon({
    className: 'depot-div-icon',
    html,
    iconSize: [size, size],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY + 8],
  });
}

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function pinShades(baseHex: string): { base: string; highlight: string } {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return { base: baseHex, highlight: baseHex };
  const highlight = mix(rgb, { r: 255, g: 255, b: 255 }, 0.18);
  return { base: rgbToHex(rgb), highlight: rgbToHex(highlight) };
}

function lighten(hex: string, t = 0.3): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(mix(rgb, { r: 255, g: 255, b: 255 }, t));
}

/** Numbered stop marker as a DivIcon */
function makeNumberedIcon(n: number, color = '#4f46e5'): L.DivIcon {
  const { base, highlight } = pinShades(color);
  const gradientId = `pin-g-${Math.random().toString(36).slice(2, 8)}`;
  const size = 30;
  const anchorX = size / 2;
  const anchorY = size;

  const html = `
    <div style="
      width:${size}px;height:${size}px;position:relative;transform:translate3d(0,0,0);
      filter: drop-shadow(0 1.5px 2px rgba(0,0,0,.35));
    ">
      <svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
        <defs>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${highlight}" />
            <stop offset="100%" stop-color="${base}" stop-opacity="0.95"/>
          </linearGradient>
        </defs>
        <path d="M24 2C14.1 2 6 10.1 6 20c0 10.5 11.2 19.9 16.7 24.1a 2 2 0 0 0 2.6 0C30.8 39.9 42 30.5 42 20 42 10.1 33.9 2 24 2Z" fill="url(#${gradientId})"/>
        <circle cx="24" cy="19.5" r="9.5" fill="white"/>
        <text x="24" y="23" text-anchor="middle" font-size="12" font-weight="700" fill="#111827" font-family="Inter, system-ui, Segoe UI, Roboto, Arial">
          ${String(n)}
        </text>
      </svg>
    </div>
  `;
  return L.divIcon({
    className: 'num-div-icon',
    html,
    iconSize: [size, size],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY + 8],
  });
}

function toArray<T>(items: T[] | Record<string, T> | undefined | null): T[] {
  if (!items) return [];
  return Array.isArray(items) ? items : Object.values(items);
}

function defaultTruck(): TruckOpts {
  return { grossWeight: 28000 };
}

function MilkRunMap({
  depot,
  sites,
  vehicle,
  driver,
  truck,
  transportMode = 'truck',
  routingMode = 'fast',
  departureTimeISO,
  mapKey,
  color = '#4f46e5',
}: Props) {
  const sitesArr = useMemo(() => toArray<Site>(sites), [sites]);

  const vehicleLabel = getVehicleLabel(vehicle);
  const driverName = getDriverName(driver);

  // Formatters
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmtKg = (v?: number | null) => (typeof v === 'number' ? `${nf0.format(v)} kg` : '—');
  const fmtSurface = (v?: number | null) => (typeof v === 'number' ? `${nf2.format(v)} ml` : '—');
  const fmtTime = (t?: number | string | null) => {
    if (typeof t === 'string' && t.length) return t;
    if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString().substring(11, 16);
    return '—';
  };

  // Build ordered list: depot -> sites… -> depot (closed loop when depot exists)
  const allPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];

    const depotLat = depot?.coordinates?.latitude;
    const depotLng = depot?.coordinates?.longitude;
    const hasDepot = isFiniteCoord(depotLat) && isFiniteCoord(depotLng);

    if (hasDepot) pts.push([depotLat as number, depotLng as number]);

    for (const s of sitesArr) {
      const lat = s?.coordinates?.latitude;
      const lng = s?.coordinates?.longitude;
      if (isFiniteCoord(lat) && isFiniteCoord(lng)) pts.push([lat, lng]);
    }

    // Close the loop if a depot exists
    if (hasDepot && pts.length >= 1) {
      const start = [depotLat as number, depotLng as number] as [number, number];
      const end = pts[pts.length - 1];
      if (!(end[0] === start[0] && end[1] === start[1])) pts.push(start);
    }

    return pts;
  }, [depot, sitesArr]);

  // =================== Per-leg HERE routing (frontend-only) ===================
  // Shape: routedLegs[legIndex] => [ [lat,lng], ... ]
  const [routedLegs, setRoutedLegs] = useState<Array<[number, number][]>>([]);
  const [routingErrors, setRoutingErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // stable depot icon
  const lineColor = color || '#4f46e5';
  const depotIcon = useMemo(() => makeDepotIcon(lineColor), [lineColor]);
  const dashColor = useMemo(() => lighten(lineColor, 0.4), [lineColor]);

  useEffect(() => {
    setRoutingErrors([]);
    setRoutedLegs([]);

    if (allPoints.length < 2) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const doFetch = async () => {
      // Build leg pairs (i -> i+1)
      const legs = Array.from({ length: allPoints.length - 1 }, (_, i) => [allPoints[i], allPoints[i + 1]] as [number, number][]);

      try {
        const decodedLegs = await pMapLimit(legs, 4, async (leg) => {
          try {
            const line = await fetchHereRoute(leg, controller.signal, {
              transportMode,
              routingMode,
              departureTimeISO,
              truck: { ...(defaultTruck()), ...(truck || {}) },
            });
            return line;
          } catch {
            return [] as [number, number][];
          }
        });

        if (!controller.signal.aborted) {
          setRoutedLegs(decodedLegs);
          setRoutingErrors(decodedLegs.map(l => (l.length ? '' : 'Routing failed')));
        }
      } catch (e: any) {
        if (!controller.signal.aborted) {
          setRoutedLegs([]);
          setRoutingErrors([e?.message || 'Routing failed']);
        }
      }
    };

    void doFetch();
    return () => controller.abort();
  }, [JSON.stringify(allPoints), transportMode, routingMode, departureTimeISO, JSON.stringify(truck)]);

  const initialCenter: [number, number] = allPoints[0] ?? DEFAULT_CENTER;
  const straightPath = allPoints; // fallback if legs are empty

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          Carte du milk run
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1"><RouteIcon className="h-4 w-4" aria-hidden /> Itinéraire</span>
          {vehicleLabel && <span>• Véhicule: <b>{vehicleLabel}</b></span>}
          {driverName && <span>• Chauffeur: <b>{driverName}</b></span>}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="p-0">
        <div className="relative isolate overflow-hidden rounded-md" style={{ height: 520, width: '100%' }}>
          <MapContainer
            key={`${mapKey ?? 'milk-run-map'}-${lineColor}`}
            center={initialCenter}
            zoom={DEFAULT_ZOOM}
            className="h-full w-full"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Auto-fit once mounted */}
            <FitToPoints points={allPoints} />

            {/* Depot marker with custom icon */}
            {depot &&
              isFiniteCoord(depot?.coordinates?.latitude) &&
              isFiniteCoord(depot?.coordinates?.longitude) && (
                <Marker
                  key={`depot-${lineColor}`}
                  position={[depot.coordinates!.latitude as number, depot.coordinates!.longitude as number]}
                  icon={depotIcon}
                  zIndexOffset={1000}
                >
                  <Popup>
                      <div className="space-y-0.5">
                        <div><b>{getSiteName(depot) ?? '—'}</b></div>
                        <div className="text-xs text-muted-foreground">Dépôt</div>
                        {vehicleLabel && <div>Véhicule: {vehicleLabel}</div>}
                        {driverName && <div>Chauffeur: {driverName}</div>}
                      </div>
                    </Popup>
                </Marker>
              )}

            {/* Numbered site markers */}
            {sitesArr.map((site, idx) => {
              const lat = site.coordinates?.latitude;
              const lng = site.coordinates?.longitude;
              if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return null;
              return (
                <Marker
                  key={`${(site as any).id ?? `${idx}-${lat}-${lng}`}|${lineColor}`}
                  position={[lat, lng]}
                  icon={makeNumberedIcon(idx + 1, lineColor)}
                  zIndexOffset={900}
                >
                  <Popup>
                    <div className="space-y-0.5">
                      <div><b>{getSiteName(site) ?? `Site ${idx + 1}`}</b></div>
                      {site.address ? <div className="text-xs text-muted-foreground">{site.address}</div> : null}
                      {/* show service time if present (seconds -> HH:MM) */}
                      {typeof site.service_time === 'number' ? (
                        <div className="text-xs text-muted-foreground">Service: {fmtTime(site.service_time)}</div>
                      ) : null}
                      {/* optional demand fields */}
                      {typeof (site as any).demand_weight === 'number' || typeof (site as any).demand_surface === 'number' ? (
                        <div className="text-xs text-muted-foreground">
                          {typeof (site as any).demand_weight === 'number' ? `Poids: ${fmtKg((site as any).demand_weight)}` : ''}
                          {typeof (site as any).demand_weight === 'number' && typeof (site as any).demand_surface === 'number' ? ' • ' : ''}
                          {typeof (site as any).demand_surface === 'number' ? `Surface: ${fmtSurface((site as any).demand_surface)}` : ''}
                        </div>
                      ) : null}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Routed polylines per leg (preferred) */}
            {routedLegs.map((line, li) => (
              line.length > 1 ? (
                <Polyline key={`leg-${li}`} positions={line} pathOptions={{ color: lineColor, weight: 4 }} />
              ) : null
            ))}

            {/* Fallback straight-line polyline for the whole loop */}
            {(!routedLegs.length || routedLegs.every(l => l.length <= 1)) && straightPath.length > 1 && (
              <Polyline positions={straightPath} pathOptions={{ color: dashColor, weight: 3, dashArray: '6 6' }} />
            )}

            {/* Tiny debug control */}
            {routingErrors.some(Boolean) && (
              <div className="leaflet-top leaflet-right">
                <div className="leaflet-control rounded-md border bg-white px-2 py-1 text-xs shadow">
                  Routing fallback active
                </div>
              </div>
            )}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(MilkRunMap);
