#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// License guardrail: fails CI when a production dependency uses a license
// outside the allow-list. Mirrors the spirit of cuevote-client/scripts/check-i18n.mjs
// (strict, non-zero exit on any failure) but for legal/SPDX compliance.
//
// Run locally: node scripts/check-licenses.mjs

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROJECTS = [
	{ name: 'cuevote-client', dir: join(ROOT, 'cuevote-client'), selfPackage: 'cuevote-client@0.0.0' },
	{ name: 'cuevote-server', dir: join(ROOT, 'cuevote-server'), selfPackage: 'cuevote-server@1.0.0' },
	{ name: 'cuevote-mcp', dir: join(ROOT, 'cuevote-mcp'), selfPackage: 'cuevote-mcp@0.1.0' },
];

// Allow-list. Add new SPDX identifiers here only after manual review.
// Copyleft (GPL/AGPL/LGPL) deliberately NOT included — fails by design.
const ALLOWED = [
	'MIT',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Apache-2.0',
	'(MIT OR WTFPL)',
	'(BSD-2-Clause OR MIT OR Apache-2.0)',
];

let hadFailure = false;

for (const project of PROJECTS) {
	process.stdout.write(`Checking ${project.name}… `);
	try {
		execFileSync(
			'npx',
			[
				'--yes',
				'license-checker',
				'--production',
				'--onlyAllow',
				ALLOWED.join(';'),
				'--excludePackages',
				project.selfPackage,
				'--summary',
			],
			{ cwd: project.dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
		);
		console.log('ok');
	} catch (err) {
		hadFailure = true;
		console.log('FAIL');
		const stderr = err.stderr?.toString() ?? '';
		const stdout = err.stdout?.toString() ?? '';
		console.error(stderr || stdout || err.message);
	}
}

if (hadFailure) {
	console.error('');
	console.error('Production dependencies include a license outside the allow-list.');
	console.error('Either remove the dependency, swap for a permissively-licensed alternative,');
	console.error('or — only after legal review — extend ALLOWED in scripts/check-licenses.mjs.');
	console.error('Remember to regenerate NOTICES.md (node scripts/build-notices.mjs) on any change.');
	process.exit(1);
}

console.log('All production dependencies are under permitted licenses.');
