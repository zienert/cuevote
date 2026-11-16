// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Apple Music developer tokens.
//
// MusicKit on the Web and the Apple Music API accept only an ES256-signed JWT:
// header { alg: 'ES256', kid: <10-character Key ID> }, claims { iss: <10-character
// Team ID>, iat, exp } with exp at most 15777000 s (6 months) ahead, and, for web
// clients, an `origin` array that Apple matches against the request's Origin
// header.
// https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens
//
// The token is not a secret: MusicKit JS runs in the host's browser and needs it
// there. The private key that signs it is, so it stays on the server as a file
// and never leaves this module, not even in an error message. Apple Music stays
// off unless all three settings are present and valid:
//   APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY_PATH
const crypto = require('crypto');
const fs = require('fs');

const DEVELOPER_TOKEN_PATH = '/api/apple-music/developer-token';

// Apple's cap on exp - now.
const APPLE_MAX_TTL_SECONDS = 15777000;
// What we sign. A day keeps a leaked token short-lived. Re-signing once less
// than half is left means every token handed out still runs at least twelve
// hours, longer than a party.
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const RENEW_BELOW_SECONDS = 12 * 60 * 60;

// Team ID and Key ID are both 10 characters, capital letters and digits.
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;

function base64UrlJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Reads the three settings.
 * - none set: { enabled: false, problems: [] } (Apple Music is simply off)
 * - some set, but wrong or missing: { enabled: false, problems: [...] }
 * - all usable: { enabled: true, problems: [], teamId, keyId, privateKey }
 * Problems name the setting at fault and never quote the key file's contents.
 */
function readConfig(env = process.env) {
    const teamId = (env.APPLE_MUSIC_TEAM_ID || '').trim();
    const keyId = (env.APPLE_MUSIC_KEY_ID || '').trim();
    const keyPath = (env.APPLE_MUSIC_PRIVATE_KEY_PATH || '').trim();
    if (!teamId && !keyId && !keyPath) return { enabled: false, problems: [] };

    const problems = [];
    if (!APPLE_ID_PATTERN.test(teamId)) {
        problems.push('APPLE_MUSIC_TEAM_ID must be the 10-character Team ID');
    }
    if (!APPLE_ID_PATTERN.test(keyId)) {
        problems.push('APPLE_MUSIC_KEY_ID must be the 10-character Key ID');
    }

    let privateKey = null;
    if (!keyPath) {
        problems.push('APPLE_MUSIC_PRIVATE_KEY_PATH is not set');
    } else {
        let pem = null;
        try {
            pem = fs.readFileSync(keyPath, 'utf8');
        } catch (err) {
            problems.push(`APPLE_MUSIC_PRIVATE_KEY_PATH cannot be read (${err.code || 'read error'})`);
        }
        if (pem !== null) {
            let key = null;
            try {
                key = crypto.createPrivateKey(pem);
            } catch {
                problems.push('APPLE_MUSIC_PRIVATE_KEY_PATH holds no PEM private key (expected the MusicKit .p8 file)');
            }
            if (key) {
                if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
                    privateKey = key;
                } else {
                    problems.push('APPLE_MUSIC_PRIVATE_KEY_PATH is not an EC P-256 key (expected the MusicKit .p8 file)');
                }
            }
        }
    }

    if (problems.length) return { enabled: false, problems };
    return { enabled: true, problems: [], teamId, keyId, privateKey };
}

/**
 * The `origin` claim takes bare web origins ("https://cuevote.com"). Taken from
 * ALLOWED_ORIGINS, which already lists every origin the site is served from;
 * entries that are not http(s) URLs are dropped.
 */
function originsForClaim(allowedOrigins) {
    const origins = [];
    for (const entry of allowedOrigins || []) {
        let url;
        try {
            url = new URL(entry);
        } catch {
            continue;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        if (!origins.includes(url.origin)) origins.push(url.origin);
    }
    return origins;
}

/**
 * Returns a function that hands out { token, expiresAt } (expiresAt in ms), and
 * signs a new token when there is none yet or less than RENEW_BELOW_SECONDS of
 * the current one remain.
 */
function createTokenSigner({ teamId, keyId, privateKey, origins = [], now = Date.now }) {
    let current = null;
    return function getDeveloperToken() {
        const nowSeconds = Math.floor(now() / 1000);
        if (!current || current.exp - nowSeconds < RENEW_BELOW_SECONDS) {
            const claims = { iss: teamId, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS };
            if (origins.length) claims.origin = origins;
            const signingInput = `${base64UrlJson({ alg: 'ES256', kid: keyId })}.${base64UrlJson(claims)}`;
            // JWS wants the raw r||s signature, not DER: ieee-p1363.
            const signature = crypto.sign('sha256', Buffer.from(signingInput), {
                key: privateKey,
                dsaEncoding: 'ieee-p1363',
            });
            current = { token: `${signingInput}.${signature.toString('base64url')}`, exp: claims.exp };
        }
        return { token: current.token, expiresAt: current.exp * 1000 };
    };
}

function sendJson(req, res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * Answers GET and HEAD on DEVELOPER_TOKEN_PATH. Without a signer (Apple Music
 * off) it answers 404 apple_music_disabled, so a client can tell "not set up"
 * from a broken server.
 */
function handleDeveloperTokenRequest(req, res, getDeveloperToken, logger) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
    }
    if (!getDeveloperToken) {
        sendJson(req, res, 404, { error: 'apple_music_disabled' });
        return;
    }
    let body;
    try {
        body = getDeveloperToken();
    } catch (err) {
        logger.error(`[AppleMusic] Signing a developer token failed: ${err && err.message}`);
        sendJson(req, res, 500, { error: 'apple_music_unavailable' });
        return;
    }
    sendJson(req, res, 200, body);
}

/**
 * Reads the settings once at startup, signs a first token so a bad key shows up
 * now rather than at the first party, and logs whether Apple Music is on.
 * Returns { enabled, getDeveloperToken, getServerToken, handleRequest(req, res) }.
 * getServerToken signs without the origin claim: the server's own catalog
 * requests carry no Origin header, and that token never leaves the server.
 */
function setup({ env = process.env, allowedOrigins = [], logger, now = Date.now }) {
    const off = () => ({
        enabled: false,
        getDeveloperToken: null,
        getServerToken: null,
        handleRequest: (req, res) => handleDeveloperTokenRequest(req, res, null, logger),
    });

    const config = readConfig(env);
    if (!config.enabled) {
        if (config.problems.length) {
            logger.error(`[AppleMusic] Off, the settings are incomplete: ${config.problems.join('; ')}`);
        } else {
            logger.info('[AppleMusic] Off (APPLE_MUSIC_* not set)');
        }
        return off();
    }

    const origins = originsForClaim(allowedOrigins);
    const getDeveloperToken = createTokenSigner({
        teamId: config.teamId,
        keyId: config.keyId,
        privateKey: config.privateKey,
        origins,
        now,
    });
    try {
        getDeveloperToken();
    } catch (err) {
        logger.error(`[AppleMusic] Off, the key cannot sign: ${err && err.message}`);
        return off();
    }
    const getServerToken = origins.length
        ? createTokenSigner({ teamId: config.teamId, keyId: config.keyId, privateKey: config.privateKey, now })
        : getDeveloperToken;
    const scope = origins.length ? `for ${origins.join(', ')}` : 'without an origin restriction';
    logger.info(`[AppleMusic] On: developer tokens signed with key ${config.keyId} ${scope}`);
    return {
        enabled: true,
        getDeveloperToken,
        getServerToken,
        handleRequest: (req, res) => handleDeveloperTokenRequest(req, res, getDeveloperToken, logger),
    };
}

module.exports = {
    DEVELOPER_TOKEN_PATH,
    APPLE_MAX_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
    RENEW_BELOW_SECONDS,
    readConfig,
    originsForClaim,
    createTokenSigner,
    handleDeveloperTokenRequest,
    setup,
};
