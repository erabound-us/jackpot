const fs = require('fs');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// The broken line in server.js F5 check route
// Find the broken fragment and restore it
const broken = "  else if (raw > 0)        { prize = raw; prizeDisplay = 'approx \n});";
const fixed  = "  else if (raw > 0)        { prize = raw; prizeDisplay = 'approx $' + prize.toLocaleString(); }\n  else                     { prizeDisplay = 'No prize'; }\n  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' });\n});";

const idx = src.indexOf(broken);
if (idx !== -1) {
  src = src.slice(0, idx) + fixed + src.slice(idx + broken.length);
  console.log('F5 server.js fixed at idx', idx);
} else {
  // Try to find what's actually there
  const i2 = src.indexOf("else if (raw > 0)        { prize = raw; prizeDisplay = 'approx ");
  console.log('Broken fragment idx:', i2);
  if (i2 !== -1) console.log('Context:', JSON.stringify(src.slice(i2, i2+200)));
}

// Verify node can parse it
const { execSync } = require('child_process');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot' });
  console.log('Syntax OK');
} catch(e) {
  console.log('Syntax error:', e.stderr ? e.stderr.toString() : e.message);
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
