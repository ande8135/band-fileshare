// Cognito hosted UI sign-in: authorization code flow with PKCE, tokens kept in localStorage.
import { cfg } from "./config";

interface Tokens {
  id: string;
  refresh: string;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

const store = {
  get(): Tokens | null {
    try {
      return JSON.parse(localStorage.getItem("tokens") ?? "null") as Tokens | null;
    } catch {
      return null;
    }
  },
  set: (t: Tokens) => localStorage.setItem("tokens", JSON.stringify(t)),
  clear: () => localStorage.removeItem("tokens"),
};

export function decodeJwt<T = Record<string, unknown>>(token: string): T {
  const part = token.split(".")[1] ?? "";
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as T;
}

export async function login(): Promise<void> {
  const verifier = rand(48);
  const state = rand(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("pkce", JSON.stringify({ verifier, state, hash: location.hash }));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  location.assign(`https://${cfg.cognitoDomain}/oauth2/authorize?${q}`);
}

export function logout(): void {
  store.clear();
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.redirectUri });
  location.assign(`https://${cfg.cognitoDomain}/logout?${q}`);
}

export const clearSession = () => store.clear();

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(`https://${cfg.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
  });
  if (!r.ok) throw new Error("token request failed");
  return (await r.json()) as { id_token: string; refresh_token?: string };
}

/** Completes a hosted-UI redirect if the URL carries one. Throws a user-facing message on failure. */
export async function handleCallback(): Promise<void> {
  const p = new URLSearchParams(location.search);
  if (p.has("error")) {
    history.replaceState(null, "", cfg.redirectUri);
    const d = p.get("error_description") ?? "";
    throw new Error(
      /invited|invitation/i.test(d) ? "That email hasn't been invited. Ask an admin for an invite."
        : /removed/i.test(d) ? "Your access has been removed."
          : "Sign-in failed. Please try again.",
    );
  }
  const code = p.get("code");
  if (!code) return;
  const saved = JSON.parse(sessionStorage.getItem("pkce") ?? "null") as { verifier: string; state: string; hash: string } | null;
  sessionStorage.removeItem("pkce");
  history.replaceState(null, "", cfg.redirectUri + (saved?.hash ?? ""));
  if (!saved || saved.state !== p.get("state")) throw new Error("Invalid login state");
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: saved.verifier,
  });
  store.set({ id: t.id_token, refresh: t.refresh_token ?? "" });
}

let refreshing: Promise<string | null> | null = null; // one refresh shared by concurrent callers

/** A valid ID token, refreshing it if it's about to expire; null when signed out. */
export async function idToken(): Promise<string | null> {
  const t = store.get();
  if (!t) return null;
  if (decodeJwt<{ exp: number }>(t.id).exp * 1000 - 60_000 > Date.now()) return t.id;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh })
    .then((r) => {
      store.set({ id: r.id_token, refresh: t.refresh });
      return r.id_token;
    })
    .catch(() => {
      store.clear();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
