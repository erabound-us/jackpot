const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Fix broken dateRe - d{4} should be \d{4}
const old = `  const dateRe = /(d{4}-d{2}-d{2})-fantasy5/g;`;
const neu = `  const dateRe = /([0-9]{4}-[0-9]{2}-[0-9]{2})-fantasy5/g;`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('dateRe fixed at idx', idx);
} else {
  console.log('NOT FOUND - checking what is there:');
  const i2 = src.indexOf('const dateRe =');
  if (i2 !== -1) console.log(JSON.stringify(src.slice(i2, i2+60)));
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
