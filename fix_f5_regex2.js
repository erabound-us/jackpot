const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Find all occurrences of the broken regex
let count = 0;
while (src.includes('/class="game-numbers__number"><span>(d+)</span>/g')) {
  src = src.replace('/class="game-numbers__number"><span>(d+)</span>/g',
                    String.raw`/class="game-numbers__number"><span>(\d+)<\/span>/g`);
  count++;
}
console.log('Fixed', count, 'occurrences');

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }

const remaining = (src.match(/downloadFile\(PDF_URL_F5/g) || []).length;
console.log('Remaining PDF_URL_F5 download references:', remaining);
