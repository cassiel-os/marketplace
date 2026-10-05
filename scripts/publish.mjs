#!/usr/bin/env node
// Adds an app to the Marketplace, or a newer version of it: copies its .capp into
// apps/<id>/<id>-<version>.capp (a new name per version, so a cached catalog never
// points at a package that changed), takes its icon out of the package, writes its
// entry in catalog.json from the package's own manifest (so the catalog never disagrees
// with what installs) with the package's SHA-256, and lists the apps in README.md.
// Cassiel builds every link from the id and version on the main branch: what is merged
// there is what is approved, and it installs nothing else.
//   node scripts/publish.mjs path/to/app.capp [more.capp ...]
//   node scripts/publish.mjs --remove <id> [...]       takes apps out of the Marketplace
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, FILES, ID, SDK, VERSION, isNewer, unzip } from './common.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = join(ROOT, 'catalog.json');

const args = process.argv.slice(2);
const removing = args.includes('--remove');
const names = args.filter((a) => a !== '--remove');
if (!names.length) {
  console.error('usage: node scripts/publish.mjs <app.capp> [...] | --remove <id> [...]');
  process.exit(1);
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));

if (removing) {
  for (const id of names) {
    if (!ID.test(id)) fail(`not an app id: ${id}`);
    catalog.apps = catalog.apps.filter((a) => a.id !== id);
    rmSync(join(ROOT, 'apps', id), { recursive: true, force: true });
    console.log(`removed ${id}`);
  }
} else {
  for (const capp of names) {
    const manifest = JSON.parse(unzip(capp, 'manifest.json'));
    const { id, name, version, description, author, category, icon, sdk } = manifest;
    if (!ID.test(id ?? '')) fail(`${capp}: the manifest needs an id (lowercase letters, digits, dashes)`);
    if (!name) fail(`${capp}: the manifest needs a name`);
    if (!VERSION.test(version ?? '')) fail(`${capp}: the manifest needs a version like 1.0.0`);
    if (sdk !== undefined && !SDK.test(sdk)) fail(`${capp}: "sdk" must be like "1.0"`);
    if (category !== undefined && !CATEGORIES.includes(category)) fail(`${capp}: unknown category ${category}`);
    const previous = catalog.apps.find((a) => a.id === id);
    if (previous && !isNewer(version, previous.version)) fail(`${capp}: version ${version} is not newer than the published ${previous.version}`);

    const dir = join(ROOT, 'apps', id);
    mkdirSync(dir, { recursive: true });
    // Earlier versions stay: a catalog still cached somewhere may point at them.
    copyFileSync(capp, join(dir, `${id}-${version}.capp`));
    let iconUrl;
    if (icon && /\.(svg|png)$/i.test(icon)) {
      const file = `icon${extname(icon).toLowerCase()}`;
      writeFileSync(join(dir, file), unzip(capp, icon, 'buffer'));
      iconUrl = `${FILES}apps/${id}/${file}`;
    }

    const entry = {
      id,
      name,
      version,
      description,
      author,
      category,
      sdk,
      icon: iconUrl,
      package: `${FILES}apps/${id}/${id}-${version}.capp`,
      bytes: statSync(capp).size,
      sha256: createHash('sha256').update(readFileSync(capp)).digest('hex'),
    };
    if (previous) catalog.apps[catalog.apps.indexOf(previous)] = entry;
    else catalog.apps.push(entry);
    console.log(`${previous ? 'updated' : 'added'} ${id} ${version} (${basename(capp)})`);
  }
}
catalog.apps.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);

// The README's list of apps, between its markers.
const README = join(ROOT, 'README.md');
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|');
const rows = catalog.apps.map((a) => {
  const icon = a.icon ? `<img src="apps/${a.id}/${basename(a.icon)}" width="24" alt="">` : '';
  return `| ${icon} | **${cell(a.name)}** | ${cell(a.version)} | ${cell(a.author)} | ${cell(a.description)} |`;
});
const table = ['| | App | Version | By | |', '|---|---|---|---|---|', ...rows].join('\n');
const readme = readFileSync(README, 'utf8');
writeFileSync(README, readme.replace(/<!-- apps -->[\s\S]*<!-- \/apps -->/, `<!-- apps -->\n${table}\n<!-- /apps -->`));
