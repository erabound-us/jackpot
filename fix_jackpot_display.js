const fs = require('fs');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Helper to show context around a pattern for debugging
function findContext(pattern) {
  const idx = src.indexOf(pattern);
  if (idx === -1) return 'NOT FOUND';
  return JSON.stringify(src.slice(idx, idx + 200));
}

// --- Fantasy 5 ---
// Find the exact block
const f5Old = src.match(/let prize = 0, prizeDisplay;\s+if \(raw === 'JACKPOT'\)\s+\{ prizeDisplay = 'JACKPOT'; \}\s+else if \(raw === 'FREE'\) \{ prizeDisplay = 'Free Quick Pick'; \}\s+else if \(raw > 0\)\s+\{ prize = raw; prizeDisplay = 'approx \$' \+ prize\.toLocaleString\(\); \}\s+else\s+\{ prizeDisplay = 'No prize'; \}\s+res\.json\(\{ drawn: drawn\.map\(Number\), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' \}\);/);
if (f5Old) {
  console.log('F5 block found, length:', f5Old[0].length);
  src = src.replace(f5Old[0],
    `let prize = 0, prizeDisplay;\n  if (raw === 'JACKPOT')   { const jamt = _jackpotCache['fantasy5'] && _jackpotCache['fantasy5'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw === 'FREE') { prizeDisplay = 'Free Quick Pick'; }\n  else if (raw > 0)        { prize = raw; prizeDisplay = 'approx $' + prize.toLocaleString(); }\n  else                     { prizeDisplay = 'No prize'; }\n  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' });`
  );
} else {
  console.log('F5 block NOT found. Searching for nearby text...');
  console.log(findContext("prizeDisplay = 'JACKPOT';"));
}

// --- Lotto X ---
const lxOld = src.match(/let prize = 0, prizeDisplay, multiplied = false;\s+if \(raw === 'JACKPOT'\)\s+\{ prizeDisplay = 'JACKPOT'; \}\s+else if \(raw === 'FREE'\) \{ prizeDisplay = 'Free Ticket'; \}/);
if (lxOld) {
  console.log('LX block found');
  src = src.replace(lxOld[0],
    `let prize = 0, prizeDisplay, multiplied = false;\n  if (raw === 'JACKPOT')   { const jamt = _jackpotCache['lottox'] && _jackpotCache['lottox'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw === 'FREE') { prizeDisplay = 'Free Ticket'; }`
  );
} else {
  console.log('LX block NOT found');
}

// --- Powerball ---
const pbOld = src.match(/let prize = 0, prizeDisplay, isJackpot = false;\s+if \(raw === 'JACKPOT'\) \{ isJackpot = true; prizeDisplay = 'JACKPOT'; \}\s+else if \(raw > 0\) \{\s+if \(pp > 0 && !isJackpot\) \{/);
if (pbOld) {
  console.log('PB block found');
  src = src.replace(pbOld[0],
    `let prize = 0, prizeDisplay, isJackpot = false;\n  if (raw === 'JACKPOT') { isJackpot = true; const jamt = _jackpotCache['powerball'] && _jackpotCache['powerball'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw > 0) {\n    if (pp > 0 && !isJackpot) {`
  );
} else {
  console.log('PB block NOT found');
}

// --- Mega Millions ---
const mmOld = src.match(/let prize = 0, prizeDisplay, isJackpot = false;\s+if \(raw === 'JACKPOT'\) \{ isJackpot = true; prizeDisplay = 'JACKPOT'; \}\s+else if \(raw > 0\) \{\s+if \(mp > 0\) \{/);
if (mmOld) {
  console.log('MM block found');
  src = src.replace(mmOld[0],
    `let prize = 0, prizeDisplay, isJackpot = false;\n  if (raw === 'JACKPOT') { isJackpot = true; const jamt = _jackpotCache['megamillions'] && _jackpotCache['megamillions'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw > 0) {\n    if (mp > 0) {`
  );
} else {
  console.log('MM block NOT found');
}

fs.writeFileSync(path, src);
console.log('Done.');
