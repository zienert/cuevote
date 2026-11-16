// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Which address a connection counts under, for the per-IP caps in index.js.
//
// cuevote.com runs behind Cloudflare, then nginx, then this process. nginx sets
// `X-Real-IP $remote_addr`, and $remote_addr is whoever opened the TCP
// connection to nginx: for normal traffic a Cloudflare edge server, not the
// visitor. Keyed on that, every visitor routed through the same edge server
// shared one budget, so a full room could lock out the next guest.
//
// Cloudflare names the visitor in `CF-Connecting-IP`. That header is only worth
// believing when the connection really came from Cloudflare: the origin is
// reachable directly too, and anyone can send the header themselves. X-Real-IP
// is nginx's own observation, which a client cannot set, so the visitor header
// is trusted exactly when X-Real-IP lies in Cloudflare's published ranges. This
// is what nginx's realip module would do, kept here so it needs no root on the
// server.

const net = require('net');

// Peers whose forwarding headers we believe. Everything else is treated as a
// direct client and identified by its socket address. The server binds
// 0.0.0.0, so it can be reached without going through nginx: a client that does
// so could otherwise name itself via a header and the caps would count each
// connection under a different key.
const DEFAULT_TRUSTED_PROXIES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6, as
// published on 19.10.2026. CLOUDFLARE_IPS (comma-separated CIDRs) replaces the
// list without a code change if Cloudflare ever adds a range.
const DEFAULT_CLOUDFLARE_RANGES = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

/** A comma-separated env value as a list, or null when it is unset or empty. */
function parseList(value) {
    if (typeof value !== 'string') return null;
    const items = value.split(',').map(s => s.trim()).filter(Boolean);
    return items.length ? items : null;
}

function familyOf(address) {
    const family = net.isIP(address);
    return family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : null;
}

// An IPv4 address can arrive in its IPv6-mapped form (`::ffff:1.2.3.4`).
function unmap(address) {
    return address.startsWith('::ffff:') && net.isIPv4(address.slice(7)) ? address.slice(7) : address;
}

function buildRanges(cidrs) {
    const list = new net.BlockList();
    for (const cidr of cidrs) {
        const [address, prefix] = String(cidr).split('/');
        const family = familyOf(address);
        const bits = Number(prefix);
        // A malformed entry is skipped rather than fatal: one typo in an env var
        // must not take the server down.
        if (!family || !Number.isInteger(bits)) continue;
        list.addSubnet(address, bits, family);
    }
    return list;
}

function header(req, name) {
    const value = req.headers[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A function mapping an incoming request to the address it counts under.
 */
function createClientIpResolver({ trustedProxies = DEFAULT_TRUSTED_PROXIES, cloudflareRanges = DEFAULT_CLOUDFLARE_RANGES } = {}) {
    const trusted = new Set(trustedProxies);
    const cloudflare = buildRanges(cloudflareRanges);

    const fromCloudflare = (address) => {
        const plain = unmap(address);
        const family = familyOf(plain);
        return !!family && cloudflare.check(plain, family);
    };

    return function clientIp(req) {
        const peer = req.socket.remoteAddress || 'unknown';
        if (!trusted.has(peer)) return peer;

        // What the proxy saw. nginx sets `X-Real-IP $remote_addr`, which
        // REPLACES whatever the client sent: one hop, not spoofable. A proxy that
        // only sends X-Forwarded-For built with `$proxy_add_x_forwarded_for`
        // APPENDS the peer address, so there the last element is the proxy's
        // observation and the leading ones are the client's own claim.
        let observed = header(req, 'x-real-ip');
        if (!observed) {
            const xff = header(req, 'x-forwarded-for');
            if (xff) {
                const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
                if (parts.length) observed = parts[parts.length - 1];
            }
        }
        if (!observed) return peer;

        if (fromCloudflare(observed)) {
            const visitor = header(req, 'cf-connecting-ip');
            if (visitor && net.isIP(visitor)) return unmap(visitor);
        }
        return observed;
    };
}

/** The resolver configured from the environment, as index.js uses it. */
function resolverFromEnv(env = process.env) {
    return createClientIpResolver({
        trustedProxies: parseList(env.TRUSTED_PROXY_IPS) || DEFAULT_TRUSTED_PROXIES,
        cloudflareRanges: parseList(env.CLOUDFLARE_IPS) || DEFAULT_CLOUDFLARE_RANGES,
    });
}

// An IPv6 address in canonical form ('2001:db8::1'), via the URL parser, which
// also turns an embedded IPv4 tail into hex. A zone id ('%eth0') is dropped.
function canonicalIpv6(address) {
    try {
        return new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
    } catch {
        return null;
    }
}

/**
 * The key a per-network limit counts under: an IPv4 address as it is, an IPv6
 * address by its /64 ('2001:db8:abcd:12::/64'). A single IPv6 connection
 * usually owns a whole /64, so counted by the full address one visitor could
 * be somebody new on every connection. Anything that is not an address (the
 * resolver's 'unknown') is a key of its own.
 */
function netKey(address) {
    if (typeof address !== 'string' || !address) return 'unknown';
    const plain = unmap(address.toLowerCase());
    if (!net.isIPv6(plain)) return plain;
    const canonical = canonicalIpv6(plain);
    if (!canonical) return plain;

    // Expand the '::' to count groups; the canonical form has at most one.
    const [head, tail] = canonical.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = tail === undefined
        ? left
        : [...left, ...new Array(8 - left.length - right.length).fill('0'), ...right];
    return `${canonicalIpv6(`${groups.slice(0, 4).join(':')}::`)}/64`;
}

module.exports = { createClientIpResolver, resolverFromEnv, netKey, DEFAULT_TRUSTED_PROXIES, DEFAULT_CLOUDFLARE_RANGES };
