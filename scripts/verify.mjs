#!/usr/bin/env node
// Checks the Marketplace as Cassiel will read it (and as a pull request must leave it):
// every catalog entry matches the package it names, byte for byte (SHA-256 and size),
// the manifest inside agrees with the entry, links point where Cassiel builds them, and
// nothing in apps/ is left out of the catalog. Exits 1 on any problem.
//   node scripts/verify.mjs
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, FILES, ID, SDK, VERSION, unzip } from './common.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const problem = (text) => problems.push(text);

const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog.json'), 'utf8'));
if (!Array.isArray(catalog.apps)) problem('catalog.json has no "apps" list');
const seen = new Set();

for (const a of catalog.apps ?? []) {
  const where = `catalog entry ${a.id ?? '(no id)'}`;
  if (!ID.test(a.id ?? '')) {
    problem(`${where}: bad id`);
    continue;
  }
  if (seen.has(a.id)) problem(`${where}: listed twice`);
  seen.add(a.id);
  if (!a.name) problem(`${where}: no name`);
  if (!VERSION.test(a.version ?? '')) problem(`${where}: bad version`);
  if (a.sdk !== undefined && !SDK.test(a.sdk)) problem(`${where}: bad sdk`);
  if (a.category !== undefined && !CATEGORIES.includes(a.category)) problem(`${where}: unknown category`);

  const file = join(ROOT, 'apps', a.id, `${a.id}-${a.version}.capp`);
  if (a.package !== `${FILES}apps/${a.id}/${a.id}-${a.version}.capp`) problem(`${where}: package link is not apps/<id>/<id>-<version>.capp on main`);
  if (!existsSync(file)) {
    problem(`${where}: ${file.slice(ROOT.length)} is missing`);
    continue;
  }
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) problem(`${where}: sha256 does not match the package`);
  if (statSync(file).size !== a.bytes) problem(`${where}: bytes do not match the package`);

  let manifest;
  try {
    manifest = JSON.parse(unzip(file, 'manifest.json'));
  } catch {
    problem(`${where}: the package has no readable manifest.json`);
    continue;
  }
  for (const key of ['id', 'name', 'version', 'description', 'author', 'category', 'sdk'])
    if (manifest[key] !== a[key]) problem(`${where}: "${key}" differs from the package's manifest`);

  if (a.icon !== undefined) {
    const prefix = `${FILES}apps/${a.id}/`;
    const name = String(a.icon).slice(prefix.length);
    if (!String(a.icon).startsWith(prefix) || !/^icon\.(svg|png)$/.test(name)) problem(`${where}: icon link is not apps/<id>/icon.svg|png on main`);
    else if (!existsSync(join(ROOT, 'apps', a.id, name))) problem(`${where}: its icon file is missing`);
  }
}

for (const dir of readdirSync(join(ROOT, 'apps'), { withFileTypes: true })) {
  if (dir.isDirectory() && !seen.has(dir.name)) problem(`apps/${dir.name} is not in the catalog`);
}

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${seen.size} apps`);
