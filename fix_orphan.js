const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Remove the orphaned fragment that got inserted after start().catch(...)
const orphan = "\nstart().catch(err => { console.error(err); process.exit(1); });\n + prize.toLocaleString(); }\n  else                     { prizeDisplay = 'No prize'; }\n  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' });\n\n});";
const clean  = "\nstart().catch(err => { console.error(err); process.exit(1); });";

const idx = src.indexOf(orphan);
if (idx !== -1) {
  src = src.slice(0, idx) + clean + src.slice(idx + orphan.length);
  console.log('Orphaned fragment removed at idx', idx);
} else {
  console.log('Orphan not found, searching...');
  const i2 = src.indexOf(' + prize.toLocaleString(); }\n  else                     { prizeDisplay');
  if (i2 !== -1) console.log('Found at:', i2, JSON.stringify(src.slice(i2 - 60, i2 + 200)));
}

fs.writeFileSync(path, src, 'utf8');

// Check syntax
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) {
  const msg = e.stdout ? e.stdout.toString() : e.message;
  console.log('Still broken:', msg);
}
