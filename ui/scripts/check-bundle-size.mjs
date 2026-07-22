#!/usr/bin/env node
// Bundle guard: fail the build if the largest JS chunk exceeds the gzipped
// budget. The TipTap editor chunk is a fraction of the old ~1.68 MB gz;
// cap at 512 KB and bump only after profiling.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 512 * 1024;
const ASSETS_DIR = 'dist/assets';

let entries;
try {
  entries = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'));
} catch (err) {
  console.error(`bundle-size: cannot read ${ASSETS_DIR} (did vite build run?)`);
  console.error(err.message);
  process.exit(1);
}

if (entries.length === 0) {
  console.error(`bundle-size: no .js chunks under ${ASSETS_DIR}`);
  process.exit(1);
}

const measured = entries
  .map((name) => {
    const path = join(ASSETS_DIR, name);
    const raw = readFileSync(path);
    const gz = gzipSync(raw).length;
    return { name, raw: raw.length, gz };
  })
  .sort((a, b) => b.gz - a.gz);

const fmt = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(10);

console.log('\nBundle sizes (top 10, gzipped):');
for (const { name, raw, gz } of measured.slice(0, 10)) {
  console.log(`  ${fmt(gz)} gz  ${fmt(raw)} raw  ${name}`);
}

const largest = measured[0];
const pct = ((largest.gz / LIMIT_BYTES) * 100).toFixed(1);
console.log(`\nLargest chunk: ${largest.name}`);
console.log(`  ${(largest.gz / 1024).toFixed(1)} KB gz / 512 KB budget (${pct}%)`);

if (largest.gz > LIMIT_BYTES) {
  console.error(`\nFAIL: largest chunk exceeds 512 KB gz limit by ${largest.gz - LIMIT_BYTES} bytes`);
  process.exit(1);
}

console.log('PASS: under 512 KB gz limit\n');
