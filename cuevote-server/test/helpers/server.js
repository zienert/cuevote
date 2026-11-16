// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// The real server (index.js) in a child process, for tests that need what only
// it does: connections, limits, JOIN_ROOM. Each server gets a working
// directory of its own (db.js opens ./cuevote.db there), a free port,
// production mode, no network, and a probe that records every bcrypt call
// (server-probe.js). Connections come from 127.0.0.1, a trusted proxy, so the
// X-Real-IP header picks the address the server counts them under.

const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const ORIGIN = 'http://localhost:5173';

/** A new, empty working directory for one server. */
function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cuevote-test-'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Starts index.js with `cwd` as its working directory and resolves once it
 * answers /health. Extra `env` is added to a minimal environment, so nothing
 * from the developer's shell (ADMIN_TOKEN, API keys) leaks into the test.
 */
async function startServer({ cwd, env = {}, timeoutMs = 30_000 }) {
  const port = await freePort();
  const bcryptLog = path.join(cwd, 'bcrypt-calls.log');
  fs.writeFileSync(bcryptLog, '');

  const child = spawn(
    process.execPath,
    ['--require', path.join(__dirname, 'server-probe.js'), path.join(SERVER_DIR, 'index.js')],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        PORT: String(port),
        ALLOWED_ORIGINS: ORIGIN,
        CUEVOTE_TEST_BCRYPT_LOG: bcryptLog,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(kill);
  };

  const deadline = Date.now() + timeoutMs;
  while (!(await healthy(port))) {
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`Server did not come up on port ${port}:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    port,
    stop,
    /** Everything the server has written to stdout and stderr so far. */
    output: () => output,
    /** The server's JSON log lines so far (production mode logs JSON). */
    logLines: () => output.split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }),
    /**
     * How often each bcrypt function has been called, and how many of the
     * asynchronous calls have finished: { compare, 'compare:done', hash, ... }.
     */
    bcryptCalls: () => {
      const calls = { compare: 0, 'compare:done': 0, compareSync: 0, hash: 0, 'hash:done': 0, hashSync: 0 };
      for (const line of fs.readFileSync(bcryptLog, 'utf8').split('\n')) {
        if (line in calls) calls[line]++;
      }
      return calls;
    },
    /** How many password comparisons bcrypt has started, either way. */
    passwordChecks: () => {
      const lines = fs.readFileSync(bcryptLog, 'utf8').split('\n');
      return lines.filter((line) => line === 'compare' || line === 'compareSync').length;
    },
  };
}

/** A WebSocket the server counts under `ip`. */
function connect(port, { ip } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?clientId=${randomUUID()}`, {
      origin: ORIGIN,
      headers: ip ? { 'X-Real-IP': ip } : {},
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Resolves once `condition()` holds, checking every few milliseconds. */
async function waitFor(condition, { timeoutMs = 20_000, what = 'a condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Generous: a full-cost bcrypt check takes seconds on a busy machine.
const REPLY_TIMEOUT_MS = 20_000;

/** Sends `message` and resolves with the first message back that `matches`. */
function request(ws, message, matches, timeoutMs = REPLY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      let reply;
      try {
        reply = JSON.parse(data);
      } catch {
        return;
      }
      if (!matches(reply)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`No reply to ${message.type} within ${timeoutMs} ms`));
    }, timeoutMs);
    ws.on('message', onMessage);
    ws.send(JSON.stringify(message));
  });
}

/** JOIN_ROOM: resolves with the room state, or with the error sent instead. */
function joinRoom(ws, roomId, password) {
  const payload = password === undefined ? { roomId } : { roomId, password };
  return request(ws, { type: 'JOIN_ROOM', payload }, (m) => m.type === 'state' || m.type === 'error');
}

module.exports = { ORIGIN, makeWorkDir, startServer, connect, request, joinRoom, waitFor };
