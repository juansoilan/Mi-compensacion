/**
 * Offline check of weekday gaps against fixtures/sample-month.html.
 * Run: node fixtures/verify.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAY_STATUS,
  isDayCloseable,
  listMissingWeekdays,
} from '../src/shared/gaps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'sample-month.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const yearMatch = html.match(/data-mch-year="(\d+)"/);
const monthMatch = html.match(/data-mch-month="(\d+)"/);
const year = Number(yearMatch[1]);
const month = Number(monthMatch[1]);

const dayRe =
  /data-mch-day="(\d+)"\s+data-mch-status="([a-z]+)"(?:\s+data-mch-label="([^"]*)")?/g;
const days = [];
for (const match of html.matchAll(dayRe)) {
  days.push({
    day: Number(match[1]),
    status: match[2],
    label: match[3],
  });
}

const missing = listMissingWeekdays(days, year, month);
const missingDays = missing.map((d) => d.day);

const expectedMissing = [
  5, 6, 7, 8, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30,
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(year === 2026 && month === 10, 'Fixture month should be 2026-10');
assert(days.length >= 28, `Expected many day cells, got ${days.length}`);
assert(
  JSON.stringify(missingDays) === JSON.stringify(expectedMissing),
  `Missing days mismatch.\n expected ${expectedMissing}\n got      ${missingDays}`,
);

const festivo = days.find((d) => d.day === 9);
assert(festivo?.status === DAY_STATUS.covered, 'Day 9 should be covered');
assert(!isDayCloseable(days, 1), 'Day 1 already recorded');
assert(isDayCloseable(days, 5), 'Day 5 should be closeable');

assert(html.includes('data-mch-field="entry"'), 'Demo entry field missing');
assert(html.includes('data-mch-field="exit"'), 'Demo exit field missing');
assert(html.includes('data-mch-submit'), 'Demo submit missing');

console.log('verify.mjs OK');
console.log(`  month: ${year}-${String(month).padStart(2, '0')}`);
console.log(`  portal days parsed: ${days.length}`);
console.log(`  missing weekdays: ${missingDays.join(', ')}`);
