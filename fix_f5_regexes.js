const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

function sr(src, old, neu, label) {
  const idx = src.indexOf(old);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'fixed at idx', idx);
  return src.slice(0, idx) + neu + src.slice(idx + old.length);
}

// Fix broken regexes in the new _appendFantasy5DeltasImpl
src = sr(src,
  `/(\d{4}-\d{2}-\d{2})-fantasy5/g`,
  `/(\d{4}-\d{2}-\d{2})-fantasy5/g`,
  'dateRe'
);

src = sr(src,
  `/class="game-numbers__number"><span>(d+)<\/span>/g`,
  `/class="game-numbers__number"><span>(\d+)<\/span>/g`,
  'numRe in impl'
);

// Also fix in the test endpoint if present
src = sr(src,
  `/class="game-numbers__number"><span>(d+)<\\/span>/g`,
  `/class="game-numbers__number"><span>(\d+)<\\/span>/g`,
  'numRe in test'
);

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }

// Verify remaining PDF references
const remaining = (src.match(/downloadFile\(PDF_URL_F5/g) || []).length;
console.log('Remaining PDF_URL_F5 download references:', remaining);
