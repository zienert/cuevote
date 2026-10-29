// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// OAuth 2.1 Authorization Server for the remote DJ MCP. CueVote is the AS;
// identity comes from the web consent page (Google login) in prod, or from a
// configured dev user when testing. PKCE is validated by the SDK token handler
// via challengeForAuthorizationCode. Tokens are opaque + revocable.
//
// NOTE: stores are in-memory — a restart invalidates tokens/clients (users
// re-authorize). Phase 3 hardening: move to SQLite.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { config } from "../config.js";
import { audit } from "../audit.js";

// Short, non-reversible handle for a token, so an issue can be tied to its
// revocation in the log without the log itself holding credentials.
const fingerprint = (token: string): string =>
  createHash("sha256").update(token).digest("hex").slice(0, 12);

const ACCESS_TTL = 3600; // 1h
const REFRESH_TTL = 30 * 86400; // 30d
const CODE_TTL = 300; // 5m
const PENDING_TTL = 600; // 10m
const now = (): number => Math.floor(Date.now() / 1000);
const newToken = (): string => randomBytes(32).toString("hex");

interface AuthCode {
  clientId: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
}
interface TokenRec {
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: number;
}
interface Pending {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  expiresAt: number;
}

const clients = new Map<string, OAuthClientInformationFull>();
const codes = new Map<string, AuthCode>();
const accessTokens = new Map<string, TokenRec>();
const refreshTokens = new Map<string, TokenRec>();
const pending = new Map<string, Pending>();

function sweep(): void {
  const t = now();
  for (const [k, v] of codes) if (v.expiresAt < t) codes.delete(k);
  for (const [k, v] of accessTokens) if (v.expiresAt < t) accessTokens.delete(k);
  for (const [k, v] of refreshTokens) if (v.expiresAt < t) refreshTokens.delete(k);
  for (const [k, v] of pending) if (v.expiresAt < t) pending.delete(k);
}

// Reclaim expired entries even with no authorize/finalize traffic (the on-demand
// sweep calls above only fire during those flows).
const _sweepTimer = setInterval(() => sweep(), 5 * 60_000);
_sweepTimer.unref();

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    return clients.get(clientId);
  },
  registerClient(client) {
    const full = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: now(),
    } as OAuthClientInformationFull;
    clients.set(full.client_id, full);
    // Registration is open (Dynamic Client Registration, by design) and this
    // store is in-memory, so a restart erases every trace of who registered
    // what. Without this line, "was a client with a hostile redirect_uri ever
    // registered?" has no answer at all after the next restart — and for that
    // surface, absence of evidence would not be evidence of absence.
    audit("oauth_client_registered", {
      clientId: full.client_id,
      clientName: full.client_name,
      redirectUris: full.redirect_uris,
      grantTypes: full.grant_types,
      scope: full.scope,
    });
    return full;
  },
};

function issueTokens(clientId: string, userId: string, scopes: string[], grant: string): OAuthTokens {
  const access = newToken();
  const refresh = newToken();
  accessTokens.set(access, { clientId, userId, scopes, expiresAt: now() + ACCESS_TTL });
  refreshTokens.set(refresh, { clientId, userId, scopes, expiresAt: now() + REFRESH_TTL });
  audit("oauth_token_issued", {
    clientId,
    clientName: clients.get(clientId)?.client_name,
    userId,
    grant,
    scopes,
    tokenId: fingerprint(access),
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: scopes.join(" "),
  };
}

function createCode(p: Omit<AuthCode, "expiresAt">): string {
  const code = newToken();
  codes.set(code, { ...p, expiresAt: now() + CODE_TTL });
  return code;
}

// The host the consent page shows as the place the code is sent. authorize()
// puts it in the consent URL and finalizeAuthorization() compares the value the
// page echoes back, so both derive it here.
function redirectHostHint(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return ""; // non-URL redirect (e.g. custom scheme): no host to show
  }
}

export const provider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client, params, res: Response) {
    sweep();
    const scopes = params.scopes ?? [];

    // DEV ONLY: auto-approve a configured user, no Google. For testing.
    // Hard-disabled under NODE_ENV=production so a misconfigured env var can
    // never become a login bypass on the live service.
    const devUser =
      config.oauth.devUser && process.env.NODE_ENV !== "production" ? config.oauth.devUser : "";
    if (devUser) {
      const code = createCode({
        clientId: client.client_id,
        userId: devUser,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        scopes,
      });
      // Non-production only, but it IS a login bypass — record every use so a
      // dev build that somehow reaches real users is visible in the log.
      audit("oauth_dev_bypass", {
        clientId: client.client_id,
        clientName: client.client_name,
        userId: devUser,
        redirectUri: params.redirectUri,
      });
      const u = new URL(params.redirectUri);
      u.searchParams.set("code", code);
      if (params.state) u.searchParams.set("state", params.state);
      res.redirect(u.toString());
      return;
    }

    // PROD: stash the request and send the user to the web consent page, which
    // logs them in via Google and calls finalizeAuthorization().
    if (!config.oauth.consentUrl) {
      res.status(500).end("OAuth not configured (set CUEVOTE_OAUTH_CONSENT_URL or CUEVOTE_OAUTH_DEV_USER).");
      return;
    }
    const handle = newToken();
    pending.set(handle, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes,
      expiresAt: now() + PENDING_TTL,
    });
    const c = new URL(config.oauth.consentUrl);
    c.searchParams.set("auth", handle);
    // Display hints so the consent screen can name what is being authorized
    // (defends against consent phishing / confused-deputy). The redirect host is
    // the meaningful trust signal — the user should refuse an unfamiliar host.
    // The page echoes both back on approval, and finalizeAuthorization() refuses
    // values that differ from this authorization.
    if (client.client_name) c.searchParams.set("client", client.client_name);
    const redirectHost = redirectHostHint(params.redirectUri);
    if (redirectHost) c.searchParams.set("redirect", redirectHost);
    // The attempt, not just the outcome: a consent screen the user refuses
    // leaves no other trace, and a burst of these against many users is exactly
    // what a phishing run looks like.
    audit("oauth_consent_requested", {
      clientId: client.client_id,
      clientName: client.client_name,
      redirectUri: params.redirectUri,
      scopes,
    });
    res.redirect(c.toString());
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const rec = codes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id || rec.expiresAt < now()) {
      throw new InvalidGrantError("Invalid or expired authorization grant.");
    }
    return rec.codeChallenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
    const rec = codes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id || rec.expiresAt < now()) throw new InvalidGrantError("Invalid or expired authorization grant.");
    if (redirectUri && redirectUri !== rec.redirectUri) throw new InvalidGrantError("Invalid or expired authorization grant.");
    codes.delete(authorizationCode); // single use
    return issueTokens(client.client_id, rec.userId, rec.scopes, "authorization_code");
  },

  async exchangeRefreshToken(client, refreshToken, scopes) {
    const rec = refreshTokens.get(refreshToken);
    if (!rec || rec.clientId !== client.client_id || rec.expiresAt < now()) throw new InvalidGrantError("Invalid or expired authorization grant.");
    refreshTokens.delete(refreshToken); // rotate: the old refresh token is single-use
    const grantScopes = scopes && scopes.length ? scopes.filter((s) => rec.scopes.includes(s)) : rec.scopes;
    return issueTokens(client.client_id, rec.userId, grantScopes, "refresh_token");
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const rec = accessTokens.get(token);
    if (!rec || rec.expiresAt < now()) throw new InvalidTokenError("Invalid or expired access token.");
    return {
      token,
      clientId: rec.clientId,
      scopes: rec.scopes,
      expiresAt: rec.expiresAt,
      extra: { userId: rec.userId },
    };
  },

  async revokeToken(client, request: OAuthTokenRevocationRequest) {
    // Only revoke a token that belongs to the client presenting it. Without the
    // ownership check any authenticated client could revoke any token it managed
    // to learn — RFC 7009 §2.1 requires the check for exactly that reason.
    // Silence on a miss is deliberate: the endpoint must not report whether an
    // unknown token exists.
    let revoked = false;
    for (const store of [accessTokens, refreshTokens]) {
      const rec = store.get(request.token);
      if (rec && rec.clientId === client.client_id) {
        store.delete(request.token);
        revoked = true;
      }
    }
    audit("oauth_token_revoked", {
      clientId: client.client_id,
      tokenId: fingerprint(request.token),
      revoked,
    });
  },
};

/**
 * Finalize a pending authorization after the web app has logged the user in
 * with Google. `shown` is the client name and redirect host the consent page
 * displayed when the user approved; it must match this authorization. Returns
 * the redirect URL (with code + state) for the browser.
 */
export function finalizeAuthorization(
  handle: string,
  userId: string,
  shown: { client: string; host: string },
): string {
  sweep();
  const p = pending.get(handle);
  if (!p) {
    audit("oauth_consent_failed", { userId, reason: "invalid_or_expired_handle" });
    throw new Error("invalid_or_expired_handle");
  }
  pending.delete(handle);
  // The page only displays what its URL says. The approval counts only for the
  // client and host this authorization really carries; anything else spends the
  // handle without a code.
  const clientName = clients.get(p.clientId)?.client_name ?? "";
  const redirectHost = redirectHostHint(p.redirectUri);
  if (shown.client !== clientName || shown.host !== redirectHost) {
    audit("oauth_consent_failed", {
      userId,
      clientId: p.clientId,
      reason: "display_mismatch",
      shownClient: shown.client,
      shownHost: shown.host,
      redirectUri: p.redirectUri,
    });
    throw new Error("display_mismatch");
  }
  const code = createCode({
    clientId: p.clientId,
    userId,
    codeChallenge: p.codeChallenge,
    redirectUri: p.redirectUri,
    scopes: p.scopes,
  });
  // Who approved what. This is the record that says a real user consented to a
  // named client sending their authorization to a specific host.
  audit("oauth_consent_granted", {
    clientId: p.clientId,
    clientName: clients.get(p.clientId)?.client_name,
    userId,
    redirectUri: p.redirectUri,
    scopes: p.scopes,
  });
  const u = new URL(p.redirectUri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}
