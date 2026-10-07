// Writes public/licenses.txt: the licence of every package bundled into the
// app (runtime dependencies and their dependencies). Fonts (OFL) and icons
// (ISC) require their notices to ship with the app; the About dialog shows it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const seen = new Map();
function visit(name) {
  if (seen.has(name)) return;
  const dir = join(root, 'node_modules', name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const pkg = readJson(join(dir, 'package.json'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  seen.set(name, {
    name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'see package',
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : null,
  });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
}

for (const dep of Object.keys(readJson(join(root, 'package.json')).dependencies)) visit(dep);

const rule = '-'.repeat(72);
const out = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((p) => `${p.name} ${p.version} (${p.license})\n\n${p.text ?? `Licensed under ${p.license}.`}`)
  .join(`\n\n${rule}\n\n`);

writeFileSync(join(root, 'public', 'licenses.txt'), `Third-party software included in Labelsmith\n\n${rule}\n\n${out}\n`);
console.log(`licenses.txt: ${seen.size} packages`);
