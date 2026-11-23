const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const oldStr = `  if (!Array.isArray(drawn) || drawn.length !== 6 ||
      !Array.isArray(lines) || lines.length !== 3 ||
      !lines.every(l => Array.isArray(l) && l.length === 6)) {

    return res.status(400).json({ error: 'Provide drawn (6 numbers) and lines (3 x 6 numbers).' });

  }`;

const newStr = `  if (!Array.isArray(drawn) || drawn.length !== 6 ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 3 ||
      !lines.every(l => Array.isArray(l) && l.length === 6)) {
    return res.status(400).json({ error: 'Provide drawn (6 numbers) and 1-3 lines of 6 numbers each.' });
  }`;

const idx = src.indexOf(oldStr);
if (idx !== -1) {
  src = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  console.log('Server /check validation fixed at idx', idx);
} else {
  console.log('NOT FOUND');
  const i2 = src.indexOf("lines.length !== 3");
  console.log('Nearby:', i2, i2 !== -1 ? JSON.stringify(src.slice(i2-50, i2+100)) : '');
}

fs.writeFileSync(path, src, 'utf8');

try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) {
  console.log('Syntax error:', e.stdout ? e.stdout.toString() : e.message);
}
