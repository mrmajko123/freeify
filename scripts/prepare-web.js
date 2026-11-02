#!/usr/bin/env node
/* Copies the web app into a folder that the desktop / mobile wrappers package.
 * Usage: node scripts/prepare-web.js <destination> */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dest = path.resolve(process.argv[2] || path.join(root, 'build', 'www'));
const ITEMS = ['index.html', 'sw.js', 'manifest.webmanifest', 'LICENSE', 'css', 'js', 'icons'];

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const item of ITEMS) fs.cpSync(path.join(root, item), path.join(dest, item), { recursive: true });
console.log(`Web app copied to ${dest}`);
