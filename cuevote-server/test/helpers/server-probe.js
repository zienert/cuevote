// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Preloaded into the server under test (node --require, see server.js).
// Appends a line per bcrypt call to the file named by CUEVOTE_TEST_BCRYPT_LOG
// ('compare' when one starts, 'compare:done' when its promise settles), so a
// test can tell whether an attempt reached bcrypt at all. Keeps the server off
// the network, and keeps its daily backup (written next to the source, not into
// the test's directory) from running.

const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const backupScheduler = require('../../backup_scheduler');

backupScheduler.start = () => {};

const logFile = process.env.CUEVOTE_TEST_BCRYPT_LOG;
const record = (line) => {
  if (logFile) fs.appendFileSync(logFile, `${line}\n`);
};

for (const name of ['compare', 'compareSync', 'hash', 'hashSync']) {
  const original = bcrypt[name];
  bcrypt[name] = function probe(...args) {
    record(name);
    const result = original.apply(this, args);
    if (result && typeof result.then === 'function') {
      result.then(() => record(`${name}:done`), () => record(`${name}:done`));
    }
    return result;
  };
}

globalThis.fetch = async (url) => {
  throw new Error(`No network in tests: ${url}`);
};
