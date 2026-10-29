// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// finalizeAuthorization() mints a code only for the client name and redirect
// host the consent page displayed. Runs against the compiled build (npm test
// builds first).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Before the import: config reads the environment once. Without a dev user,
// authorize() takes the consent-page path; the audit log goes to a temp dir.
process.env.CUEVOTE_OAUTH_DEV_USER = "";
process.env.CUEVOTE_OAUTH_CONSENT_URL = "https://cuevote.test/connect-ai";
process.env.CUEVOTE_AUDIT_LOG = join(mkdtempSync(join(tmpdir(), "cuevote-mcp-test-")), "audit.log");

const { provider, finalizeAuthorization } = await import("../dist/oauth/provider.js");

// Register a client and start an authorization the way the SDK handler does.
// Returns the handle and the values the consent page displays.
async function startAuthorization(clientName, redirectUri) {
  const client = await provider.clientsStore.registerClient({
    ...(clientName ? { client_name: clientName } : {}),
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
  let location = "";
  const res = {
    redirect: (url) => {
      location = url;
    },
    status: () => ({ end: () => {} }),
  };
  await provider.authorize(
    client,
    { redirectUri, codeChallenge: "c".repeat(43), state: "st", scopes: ["dj"] },
    res,
  );
  const consent = new URL(location);
  return {
    handle: consent.searchParams.get("auth"),
    shown: {
      client: consent.searchParams.get("client") ?? "",
      host: consent.searchParams.get("redirect") ?? "",
    },
  };
}

describe("finalizeAuthorization", () => {
  it("returns a code for the client and host the page showed", async () => {
    const { handle, shown } = await startAuthorization("Some DJ", "https://ai.example/oauth/callback");
    assert.deepEqual(shown, { client: "Some DJ", host: "ai.example" });
    const target = new URL(finalizeAuthorization(handle, "user-1", shown));
    assert.equal(target.host, "ai.example");
    assert.ok(target.searchParams.get("code"));
    assert.equal(target.searchParams.get("state"), "st");
  });

  it("refuses a host the authorization does not carry and spends the handle", async () => {
    const { handle, shown } = await startAuthorization("Some DJ", "http://127.0.0.1:24099/cb");
    assert.throws(
      () => finalizeAuthorization(handle, "user-1", { ...shown, host: "other.example" }),
      /display_mismatch/,
    );
    assert.throws(() => finalizeAuthorization(handle, "user-1", shown), /invalid_or_expired_handle/);
  });

  it("refuses a client name the authorization does not carry", async () => {
    const { handle, shown } = await startAuthorization("Some DJ", "https://ai.example/cb");
    assert.throws(
      () => finalizeAuthorization(handle, "user-1", { ...shown, client: "Another DJ" }),
      /display_mismatch/,
    );
  });

  it("refuses an empty host when the redirect has one", async () => {
    const { handle, shown } = await startAuthorization("Some DJ", "https://ai.example/cb");
    assert.throws(() => finalizeAuthorization(handle, "user-1", { ...shown, host: "" }), /display_mismatch/);
  });

  it("accepts a redirect without host from a client without name", async () => {
    const { handle, shown } = await startAuthorization("", "com.example.app:/oauth/callback");
    assert.deepEqual(shown, { client: "", host: "" });
    const target = finalizeAuthorization(handle, "user-1", shown);
    assert.ok(target.startsWith("com.example.app:/oauth/callback?code="));
  });
});
