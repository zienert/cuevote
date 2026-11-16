// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Size limits for Dynamic Client Registration (POST /register), checked before
// the SDK's registration handler. That handler reports invalid metadata with
// every validation issue in error_description, so its reply and the validation
// work behind it grow with the number of array entries in the request. Real
// clients send a few hundred bytes with a handful of redirect URIs; a request
// beyond these limits gets one short error and never reaches the SDK.
import express, { type NextFunction, type Request, type Response } from "express";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ARRAY_ENTRIES = 20;

// Default options, like the SDK's own express.json() on this route: a body is
// parsed here exactly when the SDK would parse it, and the SDK's parser then
// skips the already-read request and uses req.body as parsed here.
const parseBody = express.json({ limit: MAX_BODY_BYTES });

function reject(res: Response, description: string): void {
  // The headers the SDK sets on this route: CORS open to any origin, no caching.
  res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.status(400).json({ error: "invalid_client_metadata", error_description: description });
}

export function registerGuard(req: Request, res: Response, next: NextFunction): void {
  parseBody(req, res, (err?: unknown) => {
    if (err) return reject(res, `Client metadata must be a JSON object of at most ${MAX_BODY_BYTES / 1024} KB.`);
    const body: unknown = req.body;
    const tooManyEntries =
      typeof body === "object" &&
      body !== null &&
      Object.values(body).some((value) => Array.isArray(value) && value.length > MAX_ARRAY_ENTRIES);
    if (tooManyEntries) return reject(res, `Each client metadata array may hold at most ${MAX_ARRAY_ENTRIES} entries.`);
    next();
  });
}
