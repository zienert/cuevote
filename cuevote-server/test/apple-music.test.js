// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appleMusic = require('../apple-music');

const TEAM_ID = 'TEAM123456';
const KEY_ID = 'KEY1234567';

let tmpDir;
let ecKeyPath;
let ecPublicKey;

function writeFile(name, contents) {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, contents, { mode: 0o600 });
    return file;
}

function env(overrides = {}) {
    return {
        APPLE_MUSIC_TEAM_ID: TEAM_ID,
        APPLE_MUSIC_KEY_ID: KEY_ID,
        APPLE_MUSIC_PRIVATE_KEY_PATH: ecKeyPath,
        ...overrides,
    };
}

function decode(token) {
    const [header, claims, signature] = token.split('.');
    return {
        header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
        claims: JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')),
        signingInput: `${header}.${claims}`,
        signature: Buffer.from(signature, 'base64url'),
    };
}

function fakeLogger() {
    const calls = { info: [], error: [] };
    return {
        calls,
        info: (msg) => calls.info.push(msg),
        error: (msg) => calls.error.push(msg),
    };
}

function fakeResponse() {
    const res = { status: null, headers: null, body: undefined, ended: false };
    res.writeHead = (status, headers = {}) => { res.status = status; res.headers = headers; };
    res.end = (body) => { res.body = body; res.ended = true; };
    return res;
}

describe('Apple Music developer tokens', () => {
    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuevote-apple-music-'));
        // Apple's .p8 is a PKCS#8 PEM holding a P-256 key.
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
            namedCurve: 'P-256',
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        ecKeyPath = writeFile('AuthKey_TEST.p8', privateKey);
        ecPublicKey = publicKey;
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('readConfig', () => {
        it('is off without complaint when nothing is set', () => {
            assert.deepEqual(appleMusic.readConfig({}), { enabled: false, problems: [] });
        });

        it('is on when all three settings are usable', () => {
            const config = appleMusic.readConfig(env());
            assert.equal(config.enabled, true);
            assert.equal(config.teamId, TEAM_ID);
            assert.equal(config.keyId, KEY_ID);
            assert.ok(config.privateKey);
        });

        it('names every missing or malformed setting', () => {
            const config = appleMusic.readConfig({ APPLE_MUSIC_TEAM_ID: 'team-1' });
            assert.equal(config.enabled, false);
            assert.equal(config.problems.length, 3);
            assert.match(config.problems.join('\n'), /APPLE_MUSIC_TEAM_ID/);
            assert.match(config.problems.join('\n'), /APPLE_MUSIC_KEY_ID/);
            assert.match(config.problems.join('\n'), /APPLE_MUSIC_PRIVATE_KEY_PATH is not set/);
        });

        it('rejects a key file that cannot be read', () => {
            const config = appleMusic.readConfig(env({ APPLE_MUSIC_PRIVATE_KEY_PATH: path.join(tmpDir, 'missing.p8') }));
            assert.equal(config.enabled, false);
            assert.deepEqual(config.problems, ['APPLE_MUSIC_PRIVATE_KEY_PATH cannot be read (ENOENT)']);
        });

        it('rejects keys that are not EC P-256', () => {
            const rsa = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            }).privateKey;
            const p384 = crypto.generateKeyPairSync('ec', {
                namedCurve: 'P-384',
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                publicKeyEncoding: { type: 'spki', format: 'pem' },
            }).privateKey;
            for (const pem of [rsa, p384]) {
                const config = appleMusic.readConfig(env({ APPLE_MUSIC_PRIVATE_KEY_PATH: writeFile('other.pem', pem) }));
                assert.equal(config.enabled, false);
                assert.match(config.problems[0], /not an EC P-256 key/);
            }
        });

        it('never quotes the key file in a problem', () => {
            const secret = 'NOT-A-KEY-BUT-SECRET-CONTENT';
            const file = writeFile('garbage.p8', `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----\n`);
            const config = appleMusic.readConfig(env({ APPLE_MUSIC_PRIVATE_KEY_PATH: file }));
            assert.equal(config.enabled, false);
            assert.match(config.problems[0], /holds no PEM private key/);
            assert.equal(config.problems.join('\n').includes(secret), false);
        });
    });

    describe('originsForClaim', () => {
        it('keeps bare http(s) origins once each and drops the rest', () => {
            assert.deepEqual(
                appleMusic.originsForClaim([
                    'https://cuevote.com',
                    'https://www.cuevote.com/',
                    'https://cuevote.com',
                    'ftp://cuevote.com',
                    'not a url',
                    'http://localhost:5173',
                ]),
                ['https://cuevote.com', 'https://www.cuevote.com', 'http://localhost:5173'],
            );
            assert.deepEqual(appleMusic.originsForClaim(undefined), []);
        });
    });

    describe('createTokenSigner', () => {
        function signer(options = {}) {
            const config = appleMusic.readConfig(env());
            return appleMusic.createTokenSigner({ ...config, ...options });
        }

        it('signs an ES256 JWT that verifies with the public key', () => {
            const { token } = signer()();
            const { header, claims, signingInput, signature } = decode(token);
            assert.deepEqual(header, { alg: 'ES256', kid: KEY_ID });
            assert.equal(claims.iss, TEAM_ID);
            assert.equal(signature.length, 64, 'JWS ES256 signatures are raw r||s, 64 bytes');
            const valid = crypto.verify('sha256', Buffer.from(signingInput), {
                key: ecPublicKey,
                dsaEncoding: 'ieee-p1363',
            }, signature);
            assert.equal(valid, true);
        });

        it("stays within Apple's six-month cap", () => {
            const start = Date.UTC(2026, 10, 12, 12, 0, 0);
            const { token, expiresAt } = signer({ now: () => start })();
            const { claims } = decode(token);
            assert.equal(claims.iat, start / 1000);
            assert.equal(claims.exp - claims.iat, appleMusic.TOKEN_TTL_SECONDS);
            assert.ok(appleMusic.TOKEN_TTL_SECONDS <= appleMusic.APPLE_MAX_TTL_SECONDS);
            assert.equal(expiresAt, claims.exp * 1000);
        });

        it('adds the origin claim only when there are origins', () => {
            const origins = ['https://cuevote.com', 'https://www.cuevote.com'];
            assert.deepEqual(decode(signer({ origins })().token).claims.origin, origins);
            assert.equal('origin' in decode(signer()().token).claims, false);
        });

        it('hands out the same token until less than twelve hours remain', () => {
            let clock = Date.UTC(2026, 10, 12, 12, 0, 0);
            const getToken = signer({ now: () => clock });
            const first = getToken();
            clock += 11 * 60 * 60 * 1000;
            assert.equal(getToken().token, first.token);
            clock += 60 * 60 * 1000 + 1000;
            const renewed = getToken();
            assert.notEqual(renewed.token, first.token);
            assert.equal(decode(renewed.token).claims.iat, Math.floor(clock / 1000));
            assert.ok(renewed.expiresAt - clock >= appleMusic.RENEW_BELOW_SECONDS * 1000);
        });
    });

    describe('handleDeveloperTokenRequest', () => {
        const getToken = () => ({ token: 'header.claims.signature', expiresAt: 1234 });

        it('answers GET with the token, never cached', () => {
            const res = fakeResponse();
            appleMusic.handleDeveloperTokenRequest({ method: 'GET' }, res, getToken, fakeLogger());
            assert.equal(res.status, 200);
            assert.equal(res.headers['Cache-Control'], 'no-store');
            assert.match(res.headers['Content-Type'], /^application\/json/);
            assert.deepEqual(JSON.parse(res.body), { token: 'header.claims.signature', expiresAt: 1234 });
        });

        it('answers HEAD with headers only', () => {
            const res = fakeResponse();
            appleMusic.handleDeveloperTokenRequest({ method: 'HEAD' }, res, getToken, fakeLogger());
            assert.equal(res.status, 200);
            assert.equal(res.body, undefined);
            assert.equal(res.ended, true);
        });

        it('refuses other methods', () => {
            const res = fakeResponse();
            appleMusic.handleDeveloperTokenRequest({ method: 'POST' }, res, getToken, fakeLogger());
            assert.equal(res.status, 405);
            assert.equal(res.headers.Allow, 'GET, HEAD');
        });

        it('answers 404 apple_music_disabled when Apple Music is off', () => {
            const res = fakeResponse();
            appleMusic.handleDeveloperTokenRequest({ method: 'GET' }, res, null, fakeLogger());
            assert.equal(res.status, 404);
            assert.deepEqual(JSON.parse(res.body), { error: 'apple_music_disabled' });
        });

        it('answers 500 and logs when signing fails', () => {
            const res = fakeResponse();
            const logger = fakeLogger();
            appleMusic.handleDeveloperTokenRequest({ method: 'GET' }, res, () => { throw new Error('boom'); }, logger);
            assert.equal(res.status, 500);
            assert.deepEqual(JSON.parse(res.body), { error: 'apple_music_unavailable' });
            assert.match(logger.calls.error[0], /boom/);
        });
    });

    describe('setup', () => {
        it('stays quietly off without settings', () => {
            const logger = fakeLogger();
            const appleMusicSetup = appleMusic.setup({ env: {}, logger });
            assert.equal(appleMusicSetup.enabled, false);
            assert.equal(logger.calls.error.length, 0);
            assert.match(logger.calls.info[0], /Off/);
            const res = fakeResponse();
            appleMusicSetup.handleRequest({ method: 'GET' }, res);
            assert.equal(res.status, 404);
        });

        it('logs what is wrong when the settings are incomplete', () => {
            const logger = fakeLogger();
            const appleMusicSetup = appleMusic.setup({ env: env({ APPLE_MUSIC_KEY_ID: '' }), logger });
            assert.equal(appleMusicSetup.enabled, false);
            assert.match(logger.calls.error[0], /APPLE_MUSIC_KEY_ID/);
        });

        it('signs with ALLOWED_ORIGINS as the origin claim when on', () => {
            const logger = fakeLogger();
            const appleMusicSetup = appleMusic.setup({
                env: env(),
                allowedOrigins: ['https://cuevote.com', 'https://www.cuevote.com'],
                logger,
            });
            assert.equal(appleMusicSetup.enabled, true);
            assert.match(logger.calls.info[0], /On: .*KEY1234567.*https:\/\/cuevote\.com, https:\/\/www\.cuevote\.com/);
            const res = fakeResponse();
            appleMusicSetup.handleRequest({ method: 'GET' }, res);
            assert.equal(res.status, 200);
            const { token } = JSON.parse(res.body);
            assert.deepEqual(decode(token).claims.origin, ['https://cuevote.com', 'https://www.cuevote.com']);
        });

        it('signs server tokens without the origin claim', () => {
            const withOrigins = appleMusic.setup({ env: env(), allowedOrigins: ['https://cuevote.com'], logger: fakeLogger() });
            const serverToken = withOrigins.getServerToken().token;
            assert.equal(decode(serverToken).claims.origin, undefined);
            assert.notEqual(serverToken, withOrigins.getDeveloperToken().token);

            const withoutOrigins = appleMusic.setup({ env: env(), logger: fakeLogger() });
            assert.equal(withoutOrigins.getServerToken, withoutOrigins.getDeveloperToken);

            assert.equal(appleMusic.setup({ env: {}, logger: fakeLogger() }).getServerToken, null);
        });
    });
});
