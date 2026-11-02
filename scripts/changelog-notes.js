#!/usr/bin/env node
/* Prints the CHANGELOG.md section for one version (used for GitHub release notes).
 * Usage: node scripts/changelog-notes.js 0.1.0 */
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
const text = fs.readFileSync(path.resolve(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = text.split('\n');
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`);
if (start < 0) { console.log(`Freeify ${version}`); process.exit(0); }
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
console.log(lines.slice(start + 1, end).join('\n').trim());
