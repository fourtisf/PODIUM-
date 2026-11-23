// Runs the prototype's ART cover functions once and writes each cover as a static SVG file.
// Usage: node scripts/export-covers.mjs   (output: apps/web/public/covers/<game>.svg)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(join(root, 'prototype/podium-v9.html'), 'utf8').split('\n');

// The cover-art section of the prototype's script: from the "cover art" comment to the GAMES
// block that follows the last ART function. It is pure string building with no DOM access.
const start = lines.findIndex((l) => l.startsWith('/* ---------- cover art ---------- */'));
const end = lines.findIndex((l, i) => i > start && l.startsWith('Object.assign(GAMES,{'));
if (start < 0 || end < 0) throw new Error('Could not find the cover art section in the prototype.');

const ART = new Function(lines.slice(start, end).join('\n') + '\nreturn ART;')();
const out = join(root, 'apps/web/public/covers');
mkdirSync(out, { recursive: true });

const keys = Object.keys(ART).sort();
for (const k of keys) {
  // In the prototype every inline copy gets unique gradient ids; a standalone file only needs valid ones.
  const svg = ART[k].split('P_').join('c_').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" ');
  writeFileSync(join(out, k + '.svg'), svg + '\n');
}
console.log(`Wrote ${keys.length} covers to apps/web/public/covers: ${keys.join(', ')}`);
