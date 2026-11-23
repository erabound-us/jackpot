const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const oldStr = `!Array.isArray(lines) || lines.length !== 3 ||\n      !lines.every(l => Array.isArray(l) && l.length === 6)) {\n    return res.status(400).json({ error: 'Provide drawn (6 numbers) and lines (3 x 6 numbers).' });`;
const newStr = `!Array.isArray(lines) || lines.length < 1 || lines.length > 3 ||\n      !lines.every(l => Array.isArray(l) && l.length === 6)) {\n    return res.status(400).json({ error: 'Provide drawn (6 numbers) and 1-3 lines of 6 numbers each.' });`;

const idx = src.indexOf(oldStr);
if (idx !== -1) {
  src = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  console.log('Fixed at idx', idx);
} else {
  console.log('NOT FOUND');
  // dump exact bytes
  const i2 = src.indexOf("lines.length !== 3");
  console.log(JSON.stringify(src.slice(i2-20, i2+200)));
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Error:', e.stdout.toString()); }
