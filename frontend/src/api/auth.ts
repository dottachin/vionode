import type { LoginRequest, TokenResponse, UserPublic } from "@/types/auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
export const AUTH_TOKEN_KEY = "ro_access_token";

// 30 minutes inactivity window
const INACTIVITY_WINDOW_MS = 30 * 60 * 1000;

// What we keep in storage
type TokenRecord = { token: string; exp: number }; // exp = last activity + window

/** Return token only if not expired; otherwise null.
 *  Also performs a sliding refresh: on each valid access, extend TTL by 30 minutes.
 */
export function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!raw) return null;

    const rec = JSON.parse(raw) as Partial<TokenRecord>;
    if (!rec || typeof rec.token !== "string" || typeof rec.exp !== "number") {
      // If old schema (plain string) or invalid, wipe to re-enforce TTL policy on next login
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return null;
    }

    const now = Date.now();
    if (now >= rec.exp) {
      // Expired due to inactivity
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return null;
    }

    // Sliding expiration: user is active (we're about to use the token), so extend window
    const newExp = now + INACTIVITY_WINDOW_MS;
    localStorage.setItem(
      AUTH_TOKEN_KEY,
      JSON.stringify({ token: rec.token, exp: newExp })
    );

    return rec.token;
  } catch {
    return null;
  }
}

/** Save token with a sliding TTL (defaults to 30 minutes).
 *  If `ttlMs` is provided, it's used for the initial window (we cap it to 30 min in `login`).
 */
export function setAuthToken(token: string | null, ttlMs = INACTIVITY_WINDOW_MS) {
  try {
    if (token) {
      const rec: TokenRecord = { token, exp: Date.now() + ttlMs };
      localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(rec));
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    /* no-op */
  }
}

export async function login(body: LoginRequest): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Login failed");
  }
  const data = (await res.json()) as TokenResponse;

  // Use access token from backend response
  const accessToken =
    (data as any).access_token ?? (data as any).token ?? null;

  // If backend returns absolute expiry, respect it but cap to 30 minutes for inactivity window.
  // This guarantees client-side inactivity expiry never exceeds server-side token validity.
  const expiresInSec = Number((data as any).expires_in ?? 0);
  const initialTtl = expiresInSec > 0
    ? Math.min(INACTIVITY_WINDOW_MS, expiresInSec * 1000)
    : INACTIVITY_WINDOW_MS;

  if (accessToken) setAuthToken(accessToken, initialTtl);

  return data;
}

export async function fetchMe(): Promise<UserPublic> {
  const token = getAuthToken(); // Touches/extends inactivity window on use
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Could not fetch the current user");
  }
  return res.json() as Promise<UserPublic>;
}

export function logout() {
  setAuthToken(null);
}
