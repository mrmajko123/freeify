#!/usr/bin/env node
/*
 * Bump (or sync) the Freeify version everywhere it appears.
 *   node scripts/bump.js patch   0.1.0 -> 0.1.1   (small update)
 *   node scripts/bump.js minor   0.1.0 -> 0.2.0   (big update)
 *   node scripts/bump.js 1.0.0   set an exact version
 *   node scripts/bump.js sync    re-write the current version into every file
 * Pushing a new version makes the release workflow publish installers on GitHub.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = (p) => path.join(root, p);
const pkg = JSON.parse(fs.readFileSync(file('package.json'), 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const arg = process.argv[2] || 'patch';

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === 'patch') next = `${ma}.${mi}.${pa + 1}`;
else if (arg === 'minor') next = `${ma}.${mi + 1}.0`;
else if (arg === 'major') next = `${ma + 1}.0.0`;
else if (arg === 'sync') next = pkg.version;
else { console.error('Usage: node scripts/bump.js patch|minor|major|sync|X.Y.Z'); process.exit(1); }

function editJson(rel) {
  if (!fs.existsSync(file(rel))) return;
  const json = JSON.parse(fs.readFileSync(file(rel), 'utf8'));
  json.version = next;
  fs.writeFileSync(file(rel), JSON.stringify(json, null, 2) + '\n');
}

function editText(rel, re, replacement) {
  const text = fs.readFileSync(file(rel), 'utf8');
  if (!re.test(text)) { console.error(`Could not find the version in ${rel}`); process.exit(1); }
  fs.writeFileSync(file(rel), text.replace(re, replacement));
}

editJson('package.json');
editJson('desktop/package.json');
editJson('mobile/package.json');
editText('js/version.js', /F\.VERSION = '[^']*'/, `F.VERSION = '${next}'`);
editText('sw.js', /const CACHE = '[^']*'/, `const CACHE = 'freeify-${next}'`);

// Add a changelog heading for the new version if there isn't one yet.
const changelog = fs.readFileSync(file('CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## ${next} `)) {
  const today = new Date().toISOString().slice(0, 10);
  const updated = changelog.replace(/\n## /, `\n## ${next} - ${today}\n\n- Describe what changed.\n\n## `);
  fs.writeFileSync(file('CHANGELOG.md'), updated);
}

console.log(`Freeify version: ${pkg.version} -> ${next}`);
