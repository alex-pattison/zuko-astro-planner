#!/usr/bin/env node
/**
 * Inventory clickable controls in index.html for risk-based test planning.
 * Not a substitute for E2E — produces a checklist of what must be covered.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const buttons = [];
const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1];
  const id = (attrs.match(/\bid=["']([^"']+)/) || [])[1] || '';
  const onclick = (attrs.match(/\bonclick=["']([^"']+)/) || [])[1] || '';
  const cls = (attrs.match(/\bclass=["']([^"']+)/) || [])[1] || '';
  const testid = (attrs.match(/\bdata-testid=["']([^"']+)/) || [])[1] || '';
  const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  buttons.push({ id, testid, onclick: onclick.slice(0, 100), cls, text });
}

const roleButtons = [];
const roleRe = /<(?:div|span|a)\b([^>]*\brole=["']button["'][^>]*)>/gi;
while ((m = roleRe.exec(html))) {
  const attrs = m[1];
  const id = (attrs.match(/\bid=["']([^"']+)/) || [])[1] || '';
  const onclick = (attrs.match(/\bonclick=["']([^"']+)/) || [])[1] || '';
  roleButtons.push({ id, onclick: onclick.slice(0, 100) });
}

console.log(`# UI control inventory (${new Date().toISOString().slice(0, 10)})`);
console.log(`buttons: ${buttons.length}`);
console.log(`role=button: ${roleButtons.length}`);
console.log(`with data-testid: ${buttons.filter((b) => b.testid).length}`);
console.log('');
console.log('## Buttons');
buttons.forEach((b, i) => {
  const label = b.text || b.id || b.onclick || b.cls;
  console.log(
    `${String(i + 1).padStart(3)} | ${(b.testid || '-').padEnd(28)} | ${(b.id || '-').padEnd(36)} | ${label}`
  );
});
if (roleButtons.length) {
  console.log('');
  console.log('## role=button');
  roleButtons.forEach((b, i) => {
    console.log(`${String(i + 1).padStart(3)} | ${(b.id || '-').padEnd(36)} | ${b.onclick || '-'}`);
  });
}
