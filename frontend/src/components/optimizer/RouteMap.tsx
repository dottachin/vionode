'use client';

/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */

import 'leaflet/dist/leaflet.css';
import { memo, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

import type { Route as OptimizedRoute } from '@/types/optimizer';
import type { Site } from '@/types/site';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Map as MapIcon, Route as RouteIcon } from 'lucide-react';

import * as flexModule from '@here/flexpolyline';

/* ============================= Helpers ============================= */

type FlexPolylineDecoder =
  | ((encoded: string) => unknown)
  | { decode?: (encoded: string) => unknown };

type VehicleLike = {
  id?: string | number; vehicle_id?: string | number; label?: string; name?: string; code?: string; registration?: string
} & Record<string, any>;

type DriverLike = {
  id?: string | number; driver_id?: string | number; name?: string; full_name?: string; first_name?: string; last_name?: string
} & Record<string, any>;

const flexNs = flexModule as unknown as { decode?: (e: string) => unknown } | undefined;
const flexDefault = (flexModule as unknown as { default?: FlexPolylineDecoder })?.default;

const SURFACE_SCALE_FACTOR = Number((import.meta as any)?.env?.VITE_SURFACE_SCALE_FACTOR ?? 100);
const WEIGHT_SCALE_FACTOR  = Number((import.meta as any)?.env?.VITE_WEIGHT_SCALE_FACTOR  ?? 100);

// Formatters (re-using the app's French number conventions)
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const fmtKg = (v?: number | null) => (typeof v === 'number' ? `${nf0.format(v)} kg` : '—');
const fmtSurface = (v?: number | null) => (typeof v === 'number' ? `${nf2.format(v)} ml` : '—');
const fmtTime = (t?: number | string | null) => {
  if (typeof t === 'string' && t.length) return t;
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString().substring(11, 16);
  return '—';
};

const DEFAULT_CENTER: [number, number] = [31.7917, -7.0926]; // Morocco
const DEFAULT_ZOOM = 6;

const safeNum = (x: unknown, fallback = 0) =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;

/** Read HERE API key (Vite or Next) */
function getHereApiKey(): string | null {
  const fromProcess =
    typeof process !== 'undefined' &&
    (process as unknown as { env?: Record<string, string | undefined> }).env?.NEXT_PUBLIC_HERE_API_KEY;

  const fromImportMeta =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env &&
    (((import.meta as any).env.VITE_HERE_API_KEY as string | undefined) ||
      ((import.meta as any).env.NEXT_PUBLIC_HERE_API_KEY as string | undefined));

  return fromProcess || fromImportMeta || null;
}

function preview(s: string, n = 24) {
  const head = s.slice(0, n);
  const tail = s.slice(-n);
  return `len=${s.length} head="${head}" tail="${tail}"`;
}

/** Google/encoded polyline (fallback) */
function decodeGooglePolyline(str: string, precision = 5): [number, number][] {
  let index = 0;
  const len = str.length;
  const coords: [number, number][] = [];
  let lat = 0, lng = 0;

  const read = () => {
    let b: number, shift = 0, result = 0;
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

/** Normalize whatever @here/flexpolyline returns into [lat,lng][] */
function normalizeFlexOutput(out: unknown): [number, number][] {
  if (Array.isArray(out) && Array.isArray(out[0])) {
    return (out as number[][]).map((p) => [p[0], p[1]]);
  }
  if (out && typeof out === 'object' && Array.isArray((out as { polyline?: number[][] }).polyline)) {
    return ((out as { polyline: number[][] }).polyline).map((p) => [p[0], p[1]]);
  }
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

/** Decode HERE flexible polyline (fallback to Google encoded) */
function decodeHerePolyline(encoded: string): [number, number][] {
  let lastErr: unknown = null;

  try {
    if (flexNs?.decode) return normalizeFlexOutput(flexNs.decode(encoded));
  } catch (e) { lastErr = e; }
  try {
    if (typeof flexDefault === 'function') return normalizeFlexOutput(flexDefault(encoded));
  } catch (e) { lastErr = e; }
  try {
    if (flexDefault && typeof (flexDefault as { decode?: (x: string) => unknown }).decode === 'function') {
      return normalizeFlexOutput((flexDefault as { decode: (x: string) => unknown }).decode(encoded));
    }
  } catch (e) { lastErr = e; }

  try {
    return decodeGooglePolyline(encoded, 5);
  } catch (e) {
    console.error(
      '[decodeHerePolyline] flexible + encoded fallback both failed.',
      '\nflex/last error:', lastErr,
      '\nencoded error:', e,
      '\npreview:', preview(encoded)
    );
    throw new Error('Failed to decode HERE polyline');
  }
}

function isFiniteCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ============================= Browser HERE routing with truck params ============================= */

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

  // Truck params to match backend matrix
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

/* ============================= Map UI pieces ============================= */

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

/** Depot icon (SVG DivIcon) */
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
          <filter id="depot-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity="0.35"/>
          </filter>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${highlight}" />
            <stop offset="100%" stop-color="${base}" stop-opacity="0.95"/>
          </linearGradient>
        </defs>
        <path filter="url(#depot-shadow)"
          d="M24 2C14.058 2 6 10.058 6 20c0 10.5 11.2 19.9 16.7 24.1a2 2 0 0 0 2.6 0C30.8 39.9 42 30.5 42 20 42 10.058 33.942 2 24 2Z"
          fill="url(#${gradientId})"/>
        <circle cx="24" cy="19.5" r="9" fill="white"/>
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

/** Numbered stop marker as a DivIcon (no external assets) */
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
        <path d="M24 2C14.1 2 6 10.1 6 20c0 10.5 11.2 19.9 16.7 24.1a2 2 0 0 0 2.6 0C30.8 39.9 42 30.5 42 20 42 10.1 33.9 2 24 2Z" fill="url(#${gradientId})"/>
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

// Colors per route (extended palette, then generate unique extras)
const BASE_ROUTE_COLORS = [
  '#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#6366f1', '#10b981', '#e11d48',
  '#8b5cf6', '#14b8a6', '#f97316', '#0ea5e9', '#a855f7', '#0f766e', '#84cc16', '#f43f5e',
];

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
  const highlight = mix(rgb, { r: 255, g: 255, b: 255 }, 0.18); // lighten a bit for the top of the pin
  return { base: rgbToHex(rgb), highlight: rgbToHex(highlight) };
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function buildColorPalette(count: number): string[] {
  if (count <= 0) return [];
  const palette: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < Math.min(count, BASE_ROUTE_COLORS.length); i++) {
    palette.push(BASE_ROUTE_COLORS[i]);
    seen.add(BASE_ROUTE_COLORS[i].toLowerCase());
  }

  if (palette.length === count) return palette;

  for (let i = palette.length; i < count; i++) {
    let hue = ((i + 1) * 137.508) % 360; // golden-angle step around the wheel
    let candidate = hslToHex(hue, 68, 52);
    while (seen.has(candidate.toLowerCase())) {
      hue = (hue + 23) % 360;
      candidate = hslToHex(hue, 68, 52);
    }
    palette.push(candidate);
    seen.add(candidate.toLowerCase());
  }

  return palette;
}

/* ============================= Consolidation & display helpers ============================= */

type Stop = OptimizedRoute['stops'][number];

/** Normalize: "site_id__virtual_source_increment" -> base "site_id" */
function baseSiteId(id: unknown): string {
  const s = String(id ?? '');
  const i = s.indexOf('_virtual_source_');
  return i >= 0 ? s.slice(0, i) : s;
}

/** Merge only ADJACENT visits to the same base site */
function consolidateStopsConsecutiveByBaseSite(stops: Stop[]): Stop[] {
  if (!stops?.length) return [];
  const out: Stop[] = [];
  let curr: Stop = { ...stops[0], site_id: baseSiteId(stops[0].site_id) } as Stop;

  for (const next of stops.slice(1)) {
    const base = baseSiteId((next as any).site_id);

    if (base === (curr as any).site_id) {
      if (typeof (next as any).weight === 'number') (curr as any).weight = ((curr as any).weight ?? 0) + (next as any).weight;
      if (typeof (next as any).surface === 'number') (curr as any).surface = ((curr as any).surface ?? 0) + (next as any).surface;
      if (typeof (next as any).service_time === 'number') (curr as any).service_time = ((curr as any).service_time ?? 0) + (next as any).service_time;
      if (typeof (next as any).distance_to_next === 'number') (curr as any).distance_to_next = ((curr as any).distance_to_next ?? 0) + (next as any).distance_to_next;
      if (typeof (next as any).co2_to_next === 'number') (curr as any).co2_to_next = ((curr as any).co2_to_next ?? 0) + (next as any).co2_to_next;

      const aC = typeof (curr as any).arrival_time === 'number' ? (curr as any).arrival_time : undefined;
      const aN = typeof (next as any).arrival_time === 'number' ? (next as any).arrival_time : undefined;
      if (aN !== undefined && (aC === undefined || aN < aC)) (curr as any).arrival_time = aN;

      const dC = typeof (curr as any).departure_time === 'number' ? (curr as any).departure_time : undefined;
      const dN = typeof (next as any).departure_time === 'number' ? (next as any).departure_time : undefined;
      if (dN !== undefined && (dC === undefined || dN > dC)) (curr as any).departure_time = dN;
    } else {
      out.push(curr);
      curr = { ...(next as any), site_id: base } as Stop;
    }
  }
  out.push(curr);
  return out;
}

// stable key so React remounts correctly when a stop changes
function stopKey(route: OptimizedRoute, stop: Stop, idx: number) {
  const site = String((stop as any).site_id ?? 'x');
  const arr = String((stop as any).arrival_time ?? '');
  const dep = String((stop as any).departure_time ?? '');
  return `${(route as any).vehicle_id ?? 'veh'}|${site}|${arr}|${dep}|${idx}`;
}

/* ========= Display name helpers ========= */

function asId(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v);
  return s.length ? s : undefined;
}

function buildIndex<T extends { id?: any }>(items?: T[] | Record<string, T>): Map<string, T> {
  const map = new Map<string, T>();
  if (!items) return map;
  if (Array.isArray(items)) {
    for (const it of items) {
      const id = asId((it as any).id ?? (it as any).site_id ?? (it as any).vehicle_id ?? (it as any).driver_id);
      if (id) map.set(id, it);
    }
  } else if (items && typeof items === 'object') {
    for (const [k, v] of Object.entries(items)) map.set(String(k), v as T);
  }
  return map;
}

function getSiteName(site?: any): string | undefined {
  if (!site) return undefined;
  return (
    site.name ?? site.site_name ?? site.title ?? site.label ??
    (site.address && site.city && site.country ? `${site.address}, ${site.city} ${site.country}` : undefined)
  );
}

function getVehicleLabel(vehicle?: VehicleLike): string | undefined {
  if (!vehicle) return undefined;
  return vehicle.label ?? vehicle.name ?? vehicle.registration ?? vehicle.code ?? undefined;
}

function getDriverName(driver?: DriverLike): string | undefined {
  if (!driver) return undefined;
  return (
    driver.name ?? driver.full_name ??
    (driver.first_name || driver.last_name ? `${driver.first_name ?? ''} ${driver.last_name ?? ''}`.trim() : undefined)
  );
}

/** Normalize the backend change: prefer route.driver_ids (array), else fallbacks */
function normalizeDriverIds(route: any): string[] {
  if (Array.isArray(route?.driver_ids) && route.driver_ids.length) return route.driver_ids.map((d: any) => String(d));
  const single = route?.driver_id ?? route?.driverId ?? route?.driver;
  return single != null ? [String(single)] : [];
}

/* ============================= Truck params helper ============================= */

function buildTruckParamsForRoute(route: any): TruckOpts {
  // Keep in sync with backend HereMatrixClient defaults
  const grossWeight = 28000;
  const hazardousGoods: string[] =
    (route?.hazardousGoods as string[]) ||
    (route?.meta?.hazardousGoods as string[]) ||
    [];
  return { grossWeight, ...(hazardousGoods.length ? { hazardousGoods } : {}) };
}

/* ============================= RouteMap ============================= */

type Props = {
  routes: OptimizedRoute[];
  sites: Site[] | Record<string, Site>;
  /** Optional: pass a unique map key from parent to force a fresh Leaflet instance on context changes */
  mapKey?: string;
  /** Vehicles (list or map) */
  vehicles?: VehicleLike[] | Record<string | number, VehicleLike>;
  /** Drivers (list or map) */
  drivers?: DriverLike[] | Record<string | number, DriverLike>;
  MAPKEY?: string;
};

function RouteMap({ routes, sites, vehicles, drivers, mapKey }: Props) {
  // indices
  const siteById = useMemo(() => buildIndex<Site>(sites as any), [sites]);
  const vehicleById = useMemo(() => buildIndex<VehicleLike>(vehicles as any), [vehicles]);
  const driverById = useMemo(() => buildIndex<DriverLike>(drivers as any), [drivers]);
  // routeLegend omitted - legend UI removed (not required)

  // coords from stop
  const coordsFromStop = (stop: { site_id: string } | null | undefined): [number, number] | null => {
    if (!stop) return null;
    const site = siteById.get(String(baseSiteId((stop as any).site_id)));
    if (!site) return null;

    const lat =
      typeof (site as any).coordinates?.latitude === 'number'
        ? (site as any).coordinates.latitude
        : typeof (site as any).latitude === 'number'
        ? (site as any).latitude
        : typeof (site as any).lat === 'number'
        ? (site as any).lat
        : null;

    const lng =
      typeof (site as any).coordinates?.longitude === 'number'
        ? (site as any).coordinates.longitude
        : typeof (site as any).longitude === 'number'
        ? (site as any).longitude
        : typeof (site as any).lng === 'number'
        ? (site as any).lng
        : null;

    if (isFiniteCoord(lat) && isFiniteCoord(lng)) return [lat, lng];
    return null;
  };

  // consolidate (adjacent)
  const consolidatedRoutes = useMemo(
    () => (routes ?? []).map((route) => ({ ...route, stops: consolidateStopsConsecutiveByBaseSite((route as any).stops ?? []) })),
    [routes]
  );

  // plotted per route
  const plottedByRoute = useMemo(
    () =>
      (consolidatedRoutes ?? []).map((route) =>
        ((route as any).stops ?? [])
          .map((stop: any) => {
            const p = coordsFromStop(stop);
            return p ? { stop, p } : null;
          })
          .filter((x: any): x is { stop: Stop; p: [number, number] } => !!x)
      ),
    [consolidatedRoutes, siteById]
  );

  // points
  const routePoints = useMemo(
    () => plottedByRoute.map((items) => items.map((i: { p: any }) => i.p)),
    [plottedByRoute]
  );

  const visibleRouteIndexes = useMemo(
    () => routePoints.map((pts, idx) => (pts.length > 1 ? idx : null)).filter((v): v is number => v !== null),
    [routePoints]
  );

  const routeColors = useMemo(
    () => buildColorPalette(consolidatedRoutes.length),
    [consolidatedRoutes.length]
  );

  // all points for bounds + initial center
  const allPoints = useMemo<[number, number][]>(() => {
    const acc: [number, number][] = [];
    for (const idx of visibleRouteIndexes) {
      const pts = routePoints[idx] ?? [];
      acc.push(...pts);
    }
    return acc;
  }, [routePoints, visibleRouteIndexes]);

  const initialCenter: [number, number] = allPoints[0] ?? DEFAULT_CENTER;

  // =================== Per-leg HERE routing (frontend-only) ===================
  // Shape: routedLines[routeIndex][legIndex] => [ [lat,lng], ... ]
  const [routedLines, setRoutedLines] = useState<Array<Array<[number, number][]>>>([]);
  const [routingErrors, setRoutingErrors] = useState<string[][]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setRoutedLines([]);
    setRoutingErrors([]);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const doFetch = async () => {
      const linesPerRoute: Array<Array<[number, number][]>> = [];
      const errsPerRoute: string[][] = [];

      for (let r = 0; r < routePoints.length; r++) {
        const pts = routePoints[r] ?? [];
        const route = (consolidatedRoutes as any[])[r];
        const truck = buildTruckParamsForRoute(route);

        if (pts.length < 2) {
          linesPerRoute.push([]);
          errsPerRoute.push([]);
          continue;
        }

        // Build leg pairs (i -> i+1)
        const legs = Array.from({ length: pts.length - 1 }, (_, i) => [pts[i], pts[i + 1]] as [number, number][]);

        try {
          // Limit per-route concurrency to 4
          const decodedLegs = await pMapLimit(legs, 4, async (leg) => {
            try {
              const dec = await fetchHereRoute(leg, controller.signal, { transportMode: 'truck', routingMode: 'fast', truck });
              return dec;
            } catch {
              return [] as [number, number][];
            }
          });

          linesPerRoute.push(decodedLegs);
          errsPerRoute.push(decodedLegs.map(l => (l.length ? '' : 'Routing failed')));
        } catch (e: any) {
          // Hard failure: fall back to a single dashed straight line later
          linesPerRoute.push([]);
          errsPerRoute.push([e?.message || 'Routing failed']);
        }
      }

      if (!controller.signal.aborted) {
        setRoutedLines(linesPerRoute);
        setRoutingErrors(errsPerRoute);
      }
    };

    void doFetch();
    return () => controller.abort();
  }, [JSON.stringify(routePoints), JSON.stringify(consolidatedRoutes)]);

  // depot
  const depotPositions = useMemo(() => plottedByRoute.map((items) => items[0]?.p ?? null), [plottedByRoute]);

  // labels
  const vehicleLabelFor = (route: any): string | undefined => {
    const vid = asId(route.vehicle_id ?? route.vehicleId ?? route.vehicle);
    if (!vid) return undefined;
    const v = vehicleById.get(vid);
    return getVehicleLabel(v);
  };

  /** Resolve zero, one, or many driver names from route + registry */
  const driverNamesFor = (route: any): string[] => {
    const ids = normalizeDriverIds(route);
    const names: string[] = [];
    for (const id of ids) {
      const d = driverById.get(id);
      const nm = getDriverName(d);
      names.push(nm ?? id);
    }
    return names;
  };

  const siteNameFor = (siteIdLike: any): string | undefined => {
    const sid = asId(baseSiteId(siteIdLike));
    if (!sid) return undefined;
    return getSiteName(siteById.get(sid));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          Route map
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          <RouteIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          Stop view — showing names (site, vehicle, driver(s))
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="p-0">
        <div className="relative isolate overflow-hidden rounded-md" style={{ height: 520, width: '100%' }}>
          {/* Legend removed — not required for current UI */}
          <MapContainer
            key={mapKey ?? 'route-map' /* optional: force a fresh instance on parent context changes */}
            center={initialCenter}
            zoom={DEFAULT_ZOOM}
            className="h-full w-full"
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
            preferCanvas
          >
            <TileLayer
              attribution='&copy; <a href="https://osm.org">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitToPoints points={allPoints} />

            {visibleRouteIndexes.map((routeIndex) => {
              const route = consolidatedRoutes[routeIndex] as any;
              const color = routeColors[routeIndex] ?? BASE_ROUTE_COLORS[routeIndex % BASE_ROUTE_COLORS.length] ?? '#4f46e5';
              const pts = routePoints[routeIndex] ?? [];
              const legs = routedLines[routeIndex] ?? [];
              const errList = routingErrors[routeIndex] ?? [];
              const depotPos = depotPositions[routeIndex];

              const vLabel = vehicleLabelFor(route) ?? String(route.vehicle_id ?? `Vehicle ${routeIndex + 1}`);
              const dNames = driverNamesFor(route);

              return (
                <Fragment key={`route-${String(route.vehicle_id ?? routeIndex)}`}>
                  {depotPos && (
                    <Marker
                      key={`depot-${routeIndex}-${color}`}
                      position={depotPos}
                      icon={makeDepotIcon(color)}
                      zIndexOffset={2000}
                    >
                      <Popup>
                        <div className="space-y-0.5">
                          {/* Show the depot site name when available */}
                          {(() => {
                            const depotStop = plottedByRoute[routeIndex]?.[0]?.stop;
                            const depotName = siteNameFor(depotStop?.site_id) ?? siteNameFor(route?.stops?.[0]) ?? String(route?.depot_id ?? 'Depot');
                            return <div><b>{depotName}</b></div>;
                          })()}
                          <div>Vehicle: {vLabel}</div>
                          {dNames.length > 0 && (
                            <div>Driver(s): {dNames.join(', ')}</div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  )}

                  {/* Numbered markers for plotted stops */}
                  {plottedByRoute[routeIndex]?.map(({ stop, p }: any, i: number) => {
                    const siteLabel = siteNameFor((stop as any).site_id) ?? String((stop as any).site_id);
                    const weight = safeNum((stop as any).weight) / WEIGHT_SCALE_FACTOR;
                    const surface = safeNum((stop as any).surface) / SURFACE_SCALE_FACTOR;
                    return (
                      <Marker
                        key={`${stopKey(route as any, stop, i)}|${color}`}
                        position={p}
                        icon={makeNumberedIcon(i + 1, color)}
                        zIndexOffset={1000}
                      >
                        <Popup>
                          <div className="space-y-0.5">
                              <div><b>{siteLabel}</b></div>
                              <div className="text-xs text-muted-foreground">
                                {weight > 0 ? `Poids : ${fmtKg(weight)}` : 'Poids : —'} &nbsp; • &nbsp; Surface : {fmtSurface(surface)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Arrival: {fmtTime((stop as any).arrival_time)} &nbsp; • &nbsp; Departure: {fmtTime((stop as any).departure_time)}
                              </div>
                            </div>
                        </Popup>
                      </Marker>
                    );
                  })}

                  {/* Routed polylines per leg */}
                  {legs.map((legLine, li) => (
                    legLine.length > 1 ? (
                      <Polyline key={`route-${routeIndex}-leg-${li}`} positions={legLine} pathOptions={{ color, weight: 4 }} />
                    ) : null
                  ))}

                  {/* If every leg failed or empty, show a single dashed straight fallback for the route */}
                  {(!legs.length || legs.every(l => l.length <= 1)) && (pts.length > 1) && (
                    <Polyline positions={pts} pathOptions={{ color: '#94a3b8', weight: 3, dashArray: '6 6' }} />
                  )}

                  {/* Compact error banner if any leg failed */}
                  {(errList.some(Boolean)) && (
                    <div className="leaflet-top leaflet-right">
                      <div className="leaflet-control rounded-md border bg-white px-2 py-1 text-xs shadow">
                        Routing fallback (route {routeIndex + 1})
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(RouteMap);
