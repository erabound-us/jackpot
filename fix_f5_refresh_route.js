const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const old = `  enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => {
    return appendFantasy5Deltas();
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'fantasy5' });`;

const neu = `  enqueueRefresh('fantasy5', () => appendFantasy5Deltas().catch(() => {}));
  clearSession(sid);
  res.json({ queued: true, game: 'fantasy5' });`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('refresh route fixed at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }

const remaining = (src.match(/downloadFile\(PDF_URL_F5/g) || []).length;
console.log('Remaining PDF_URL_F5 download references:', remaining, '(should be 2 - startup + ensureDaily)');
