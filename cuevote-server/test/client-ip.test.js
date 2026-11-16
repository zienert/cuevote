// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createClientIpResolver, resolverFromEnv, netKey } = require('../client-ip');

function req(peer, headers = {}) {
  return { socket: { remoteAddress: peer }, headers };
}

const CF_EDGE_V4 = '172.68.10.20'; // inside 172.64.0.0/13
const CF_EDGE_V6 = '2a06:98c1:3120::5'; // inside 2a06:98c0::/29
const VISITOR = '203.0.113.7';

describe('client IP', () => {
  const clientIp = createClientIpResolver();

  it('uses the socket address of a direct client and ignores its headers', () => {
    const ip = clientIp(req('198.51.100.9', { 'x-real-ip': '1.1.1.1', 'cf-connecting-ip': '2.2.2.2' }));
    assert.equal(ip, '198.51.100.9');
  });

  it('takes the visitor from CF-Connecting-IP when nginx saw a Cloudflare edge', () => {
    const ip = clientIp(req('127.0.0.1', { 'x-real-ip': CF_EDGE_V4, 'cf-connecting-ip': VISITOR }));
    assert.equal(ip, VISITOR);
  });

  it('does the same for an IPv6 edge and an IPv6 visitor', () => {
    const ip = clientIp(req('::1', { 'x-real-ip': CF_EDGE_V6, 'cf-connecting-ip': '2001:db8::42' }));
    assert.equal(ip, '2001:db8::42');
  });

  it('ignores CF-Connecting-IP from a client that bypassed Cloudflare', () => {
    // Straight to the origin through nginx: X-Real-IP is the client itself, and
    // the header is its own invention.
    const ip = clientIp(req('127.0.0.1', { 'x-real-ip': '198.51.100.9', 'cf-connecting-ip': VISITOR }));
    assert.equal(ip, '198.51.100.9');
  });

  it('falls back to the edge address when Cloudflare sent no usable visitor', () => {
    assert.equal(clientIp(req('127.0.0.1', { 'x-real-ip': CF_EDGE_V4 })), CF_EDGE_V4);
    assert.equal(clientIp(req('127.0.0.1', { 'x-real-ip': CF_EDGE_V4, 'cf-connecting-ip': 'not-an-ip' })), CF_EDGE_V4);
  });

  it('reads the last X-Forwarded-For hop when there is no X-Real-IP', () => {
    assert.equal(clientIp(req('127.0.0.1', { 'x-forwarded-for': '10.0.0.1, 198.51.100.4' })), '198.51.100.4');
    assert.equal(
      clientIp(req('127.0.0.1', { 'x-forwarded-for': `10.0.0.1, ${CF_EDGE_V4}`, 'cf-connecting-ip': VISITOR })),
      VISITOR,
    );
  });

  it('treats the IPv6-mapped loopback as the proxy', () => {
    assert.equal(clientIp(req('::ffff:127.0.0.1', { 'x-real-ip': CF_EDGE_V4, 'cf-connecting-ip': VISITOR })), VISITOR);
  });

  it('uses the peer when a trusted proxy sent no forwarding header at all', () => {
    assert.equal(clientIp(req('127.0.0.1', {})), '127.0.0.1');
  });

  it('takes its lists from the environment and skips malformed ranges', () => {
    const custom = resolverFromEnv({ TRUSTED_PROXY_IPS: '10.9.9.9', CLOUDFLARE_IPS: 'garbage, 192.0.2.0/24' });
    assert.equal(custom(req('10.9.9.9', { 'x-real-ip': '192.0.2.50', 'cf-connecting-ip': VISITOR })), VISITOR);
    assert.equal(custom(req('127.0.0.1', { 'x-real-ip': '192.0.2.50' })), '127.0.0.1', 'loopback is no longer trusted');
    // An edge address of the default list is not special under the custom one.
    assert.equal(custom(req('10.9.9.9', { 'x-real-ip': CF_EDGE_V4, 'cf-connecting-ip': VISITOR })), CF_EDGE_V4);
  });
});

describe('network key', () => {
  it('is the address itself for IPv4, also in its IPv6-mapped form', () => {
    assert.equal(netKey('203.0.113.7'), '203.0.113.7');
    assert.equal(netKey('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(netKey('::FFFF:203.0.113.7'), '203.0.113.7');
  });

  it('puts IPv6 addresses of one /64 under one key', () => {
    const a = netKey('2001:db8:abcd:12::1');
    assert.equal(a, '2001:db8:abcd:12::/64');
    assert.equal(netKey('2001:db8:abcd:12:ffff:ffff:ffff:fffe'), a);
    assert.equal(netKey('2001:0DB8:ABCD:0012:0000:0000:0000:0042'), a, 'spelling does not matter');
    assert.notEqual(netKey('2001:db8:abcd:13::1'), a, 'the next /64 is another network');
  });

  it('handles compressed, full and edge-case IPv6 spellings', () => {
    assert.equal(netKey('::1'), '::/64');
    assert.equal(netKey('1:2:3:4:5:6:7:8'), '1:2:3:4::/64');
    assert.equal(netKey('2001:db8::'), '2001:db8::/64');
    assert.equal(netKey('2001:db8:0:0:1::'), '2001:db8::/64');
    assert.equal(netKey('fe80::1%en0'), 'fe80::/64');
    assert.equal(netKey('64:ff9b::192.0.2.33'), '64:ff9b::/64');
  });

  it('keeps anything that is not an address as its own key', () => {
    assert.equal(netKey('unknown'), 'unknown');
    assert.equal(netKey(''), 'unknown');
    assert.equal(netKey(undefined), 'unknown');
  });
});
