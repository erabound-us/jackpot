const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Fix: use < instead of <= so same-day Evening isn't skipped when Midday is cached
// Also check by date+drawType key instead of just ts
const old = `  const existing = getFantasy5Draws();
  const newestTs = existing.length ? existing[0].ts : 0;
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts <= newestTs) continue;`;

const neu = `  const existing = getFantasy5Draws();
  // Build a set of existing date+drawType keys for fast lookup
  const existingKeys = new Set(existing.map(d => {
    const p = d.date.split('/');
    let yr = p[2]; if (yr.length === 2) yr = '20' + yr;
    return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0') + '|' + d.drawType;
  }));
  const newestTs = existing.length ? existing[0].ts : 0;
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts < newestTs - 86400000) continue; // skip dates more than 1 day older than newest`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('ts comparison fixed at idx', idx);
} else {
  console.log('NOT FOUND');
}

// Also update the inner check to use existingKeys
const old2 = `      if (nums.length === 5) {
        newDraws.push({ date: mmddyyyy, drawType, numbers: nums, ts: ts + (drawType === 'EVENING' ? 1 : 0) });
      }`;
const neu2 = `      const drawKey = isoDate + '|' + drawType;
      if (nums.length === 5 && !existingKeys.has(drawKey)) {
        newDraws.push({ date: mmddyyyy, drawType, numbers: nums, ts: ts + (drawType === 'EVENING' ? 1 : 0) });
      }`;

const idx2 = src.indexOf(old2);
if (idx2 !== -1) {
  src = src.slice(0, idx2) + neu2 + src.slice(idx2 + old2.length);
  console.log('existingKeys check added at idx', idx2);
} else {
  console.log('inner check NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
