#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// The PUBLIC remote DJ MCP: a Streamable-HTTP server exposing ONLY the cv_*
// DJ tools, protected by OAuth 2.1 (CueVote is the authorization server). Each
// authenticated user gets a session backed by its own CueVoteBridge, which
// connects to the WS server AS that user via a freshly minted session.
//
// SECURITY: never register ops/admin/read-only tools here. Binds to localhost;
// nginx + Cloudflare sit in front. Do not flip on the public rollout until the
// guardrails (Phase 3) land and the YouTube quota review is clear.
import express, { type Request, type Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "./config.js";
import { CueVoteBridge } from "./wsClient.js";
import { registerDjTools } from "./tools/dj.js";
import { provider, finalizeAuthorization } from "./oauth/provider.js";
import { audit } from "./audit.js";
import { mintSessionToken } from "./minter.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  bridge: CueVoteBridge;
  userId: string;
  lastSeen: number;
}
const sessions = new Map<string, Session>();
// In JSON-response mode there is no persistent socket, so transport.onclose only
// fires on an explicit DELETE. Reap idle sessions (and their bridges' WS) so a
// client that vanishes without closing can't leak them forever.
const SESSION_TTL_MS = Number(process.env.CUEVOTE_HTTP_SESSION_TTL_MS || 30 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.CUEVOTE_HTTP_MAX_SESSIONS || 1000);

const userIdOf = (req: Request): string =>
  (((req as Request & { auth?: AuthInfo }).auth?.extra?.userId as string) || "");

function rpcErr(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const app = express();
const issuerUrl = new URL(config.http.publicUrl);

// DNS-rebinding protection: when CUEVOTE_HTTP_ALLOWED_HOSTS is set, reject any
// request whose Host header isn't in the allow-list. (The SDK's transport-level
// option is deprecated in favor of external middleware.)
//
// Two paths are exempt because they are reached on localhost (Host 127.0.0.1),
// never through the public proxy: /health (uptime/LB checks) and /oauth/finalize
// (the cuevote-server calls it server-to-server; it stays protected by the
// finalize secret, so skipping the host check costs no security).
const HOST_CHECK_EXEMPT = new Set(["/health", "/oauth/finalize"]);
if (config.http.allowedHosts.length) {
  const allowed = new Set(config.http.allowedHosts.map((h) => h.split(":")[0]));
  app.use((req: Request, res: Response, next) => {
    if (HOST_CHECK_EXEMPT.has(req.path)) return next();
    const host = (req.headers.host || "").split(":")[0];
    if (!allowed.has(host)) {
      res.status(421).json({ error: "host_not_allowed" });
      return;
    }
    next();
  });
}

// OAuth 2.1 endpoints: /.well-known/*, /authorize, /token, /register, /revoke.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl,
    scopesSupported: ["dj"],
    resourceName: "CueVote DJ",
  }),
);

// Web-app callback: after Google login it finalizes a pending authorization.
// Gated by a shared secret (the web app holds CUEVOTE_OAUTH_FINALIZE_SECRET).
app.post("/oauth/finalize", express.json(), (req: Request, res: Response) => {
  const secret = config.oauth.finalizeSecret;
  const provided = (req.headers["authorization"] || "").toString().replace(/^Bearer /, "");
  if (!secret || !safeEqual(provided, secret)) {
    // This route is reached server-to-server over loopback only, so a rejection
    // here is not a user typo — it is either a misconfigured deploy or someone
    // probing the consent bridge. Record the peer: anything but 127.0.0.1 means
    // the endpoint is exposed further than it should be.
    audit("oauth_finalize_rejected", {
      reason: secret ? "bad_secret" : "not_configured",
      peer: req.socket.remoteAddress,
    });
    return void res.status(401).json({ error: "unauthorized" });
  }
  const body = (req.body ?? {}) as {
    handle?: string;
    userId?: string;
    shownClient?: unknown;
    shownHost?: unknown;
  };
  if (!body.handle || !body.userId) return void res.status(400).json({ error: "missing handle or userId" });
  // What the consent page displayed. Missing values count as empty, so a page
  // that sends none can only approve a client without name and host.
  const shown = {
    client: typeof body.shownClient === "string" ? body.shownClient : "",
    host: typeof body.shownHost === "string" ? body.shownHost : "",
  };
  try {
    res.json({ redirectTo: finalizeAuthorization(String(body.handle), String(body.userId), shown) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "finalize_failed" });
  }
});

app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok", sessions: sessions.size }));

// Every /mcp request must carry a valid OAuth access token.
const bearer = requireBearerAuth({ verifier: provider, requiredScopes: [] });

app.post("/mcp", bearer, express.json(), async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const sid = req.headers["mcp-session-id"] as string | undefined;

  if (sid) {
    const s = sessions.get(sid);
    if (!s) return rpcErr(res, 404, "Unknown or expired session.");
    if (s.userId !== userId) return rpcErr(res, 403, "Session does not belong to this user.");
    s.lastSeen = Date.now();
    await s.transport.handleRequest(req, res, req.body);
    return;
  }

  if (!isInitializeRequest(req.body)) return rpcErr(res, 400, "Initialize a session first.");
  if (!userId) return rpcErr(res, 401, "No user associated with token.");
  if (sessions.size >= MAX_SESSIONS) return rpcErr(res, 503, "Too many active sessions; try again later.");

  // Bridge connects AS this user via a freshly minted WS session per connect.
  const bridge = new CueVoteBridge(() => mintSessionToken(userId));
  const server = new McpServer({ name: "cuevote-dj", version: "0.1.0" });
  registerDjTools(server, bridge); // DJ tools ONLY.

  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id: string) => {
      sessions.set(id, { transport, bridge, userId, lastSeen: Date.now() });
    },
  });
  transport.onclose = () => {
    const id = transport.sessionId;
    if (id && sessions.has(id)) {
      try {
        sessions.get(id)!.bridge.close();
      } catch {
        /* ignore */
      }
      sessions.delete(id);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

async function handleSession(req: Request, res: Response): Promise<void> {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  const s = sid ? sessions.get(sid) : undefined;
  if (!s) return rpcErr(res, 404, "Unknown or expired session.");
  if (s.userId !== userIdOf(req)) return rpcErr(res, 403, "Session does not belong to this user.");
  s.lastSeen = Date.now();
  await s.transport.handleRequest(req, res);
}

// Reap idle sessions + their bridge WebSockets (see SESSION_TTL_MS above).
const reaper = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) {
      try { s.transport.close(); } catch { /* ignore */ }
      try { s.bridge.close(); } catch { /* ignore */ }
      sessions.delete(id);
    }
  }
}, 60_000);
reaper.unref();
app.get("/mcp", bearer, handleSession);
app.delete("/mcp", bearer, handleSession);

const httpServer = app.listen(config.http.port, config.http.host, () => {
  const devActive = config.oauth.devUser && process.env.NODE_ENV !== "production";
  console.error(
    `[cuevote-mcp:http] DJ MCP (OAuth) on ${config.http.publicUrl}/mcp — DJ tools only` +
      (devActive ? ` [DEV identity: ${config.oauth.devUser}]` : ""),
  );
  if (config.oauth.devUser && process.env.NODE_ENV === "production") {
    console.error("[cuevote-mcp:http] WARNING: CUEVOTE_OAUTH_DEV_USER is set in production and is being IGNORED — unset it.");
  }
});

function shutdown(): void {
  clearInterval(reaper);
  for (const { transport, bridge } of sessions.values()) {
    try { transport.close(); } catch { /* ignore */ }
    try { bridge.close(); } catch { /* ignore */ }
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
