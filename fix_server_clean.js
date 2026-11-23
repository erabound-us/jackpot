const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

function sliceReplace(src, oldStr, newStr, label) {
  const idx = src.indexOf(oldStr);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  const result = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  console.log(label, 'fixed at idx', idx);
  return result;
}

// --- Fantasy 5 ---
src = sliceReplace(src,
  "  let prize = 0, prizeDisplay;\n  if (raw === 'JACKPOT')   { prizeDisplay = 'JACKPOT'; }",
  "  let prize = 0, prizeDisplay;\n  if (raw === 'JACKPOT')   { const jamt = _jackpotCache['fantasy5'] && _jackpotCache['fantasy5'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }",
  'F5'
);

// --- Lotto X ---
src = sliceReplace(src,
  "  let prize = 0, prizeDisplay, multiplied = false;\n  if (raw === 'JACKPOT')   { prizeDisplay = 'JACKPOT'; }",
  "  let prize = 0, prizeDisplay, multiplied = false;\n  if (raw === 'JACKPOT')   { const jamt = _jackpotCache['lottox'] && _jackpotCache['lottox'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }",
  'LX'
);

// --- Powerball ---
src = sliceReplace(src,
  "  if (raw === 'JACKPOT') { isJackpot = true; prizeDisplay = 'JACKPOT'; }\n  else if (raw > 0) {\n    if (pp > 0 && !isJackpot) {",
  "  if (raw === 'JACKPOT') { isJackpot = true; const jamt = _jackpotCache['powerball'] && _jackpotCache['powerball'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw > 0) {\n    if (pp > 0 && !isJackpot) {",
  'PB'
);

// --- Mega Millions ---
src = sliceReplace(src,
  "  if (raw === 'JACKPOT') { isJackpot = true; prizeDisplay = 'JACKPOT'; }\n  else if (raw > 0) {\n    if (mp > 0) {",
  "  if (raw === 'JACKPOT') { isJackpot = true; const jamt = _jackpotCache['megamillions'] && _jackpotCache['megamillions'].amount; prizeDisplay = 'JACKPOT' + (jamt ? ' (~' + jamt + ')' : ''); }\n  else if (raw > 0) {\n    if (mp > 0) {",
  'MM'
);

fs.writeFileSync(path, src, 'utf8');

try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) {
  console.log('Syntax error:', e.stdout ? e.stdout.toString() : e.message);
}
