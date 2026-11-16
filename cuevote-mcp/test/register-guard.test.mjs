// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// POST /register answers oversized client metadata with one short error and
// still registers ordinary clients through the SDK. Mounts registerGuard in
// front of the SDK's auth router the way http.ts does. Runs against the
// compiled build (npm test builds first).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

// Before the import: the provider writes registrations to the audit log.
process.env.CUEVOTE_AUDIT_LOG = join(mkdtempSync(join(tmpdir(), "cuevote-mcp-test-")), "audit.log");

const { default: express } = await import("express");
const { mcpAuthRouter } = await import("@modelcontextprotocol/sdk/server/auth/router.js");
const { provider } = await import("../dist/oauth/provider.js");
const { registerGuard } = await import("../dist/oauth/registerGuard.js");

let server;
let base;

before(async () => {
  const app = express();
  app.post("/register", registerGuard);
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL("http://127.0.0.1"), scopesSupported: ["dj"] }));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

async function register(body) {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, bytes: Buffer.byteLength(text), json: JSON.parse(text) };
}

const client = (redirectUris) => ({
  client_name: "Some DJ",
  redirect_uris: redirectUris,
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});

describe("POST /register", () => {
  it("registers an ordinary client", async () => {
    const { status, json } = await register(client(["https://ai.example/oauth/callback"]));
    assert.equal(status, 201);
    assert.ok(json.client_id);
    assert.deepEqual(json.redirect_uris, ["https://ai.example/oauth/callback"]);
  });

  it("registers a client with 20 redirect URIs", async () => {
    const uris = Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${33400 + i}/callback`);
    const { status, json } = await register(client(uris));
    assert.equal(status, 201);
    assert.equal(json.redirect_uris.length, 20);
  });

  it("answers a 60 KB body with a short error", async () => {
    const body = JSON.stringify({ redirect_uris: Array(30000).fill(1) });
    assert.ok(body.length > 60000);
    const { status, bytes, json } = await register(body);
    assert.equal(status, 400);
    assert.equal(json.error, "invalid_client_metadata");
    assert.ok(bytes < 1024, `reply has ${bytes} bytes`);
  });

  it("answers an array of more than 20 entries with a short error", async () => {
    const { status, headers, bytes, json } = await register({
      ...client(["https://ai.example/oauth/callback"]),
      grant_types: Array(5000).fill(0),
    });
    assert.equal(status, 400);
    assert.equal(json.error, "invalid_client_metadata");
    assert.match(json.error_description, /at most 20 entries/);
    assert.ok(bytes < 1024, `reply has ${bytes} bytes`);
    assert.equal(headers.get("access-control-allow-origin"), "*");
  });

  it("answers malformed JSON with a short error", async () => {
    const { status, json } = await register("{");
    assert.equal(status, 400);
    assert.equal(json.error, "invalid_client_metadata");
  });

  it("leaves other invalid metadata to the SDK", async () => {
    const { status, json } = await register(client(["not a url"]));
    assert.equal(status, 400);
    assert.equal(json.error, "invalid_client_metadata");
    assert.match(json.error_description, /redirect_uris/);
  });
});
