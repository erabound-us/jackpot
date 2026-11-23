const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Remove the orphaned tail that appears after start().catch(...)
// Pattern: start().catch line followed by the orphaned fragment
const re = /(start\(\)\.catch\(err => \{ console\.error\(err\); process\.exit\(1\); \}\);)[\s\S]*?res\.json\(\{ drawn: drawn\.map\(Number\), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' \}\);\s*\}\);(\s*\n\s*\napp\.post\('\/chat\/fantasy5')/;

const m = src.match(re);
if (m) {
  console.log('Found orphan block, length:', m[0].length);
  src = src.replace(re, '$1$2');
  console.log('Removed orphan');
} else {
  // Manual approach: find start().catch line and remove everything until next app.post
  const startIdx = src.indexOf("start().catch(err => { console.error(err); process.exit(1); });");
  if (startIdx !== -1) {
    const afterStart = src.indexOf("\napp.post('/chat/fantasy5'", startIdx);
    if (afterStart !== -1) {
      const between = src.slice(startIdx + "start().catch(err => { console.error(err); process.exit(1); });".length, afterStart);
      console.log('Between start and next app.post:', JSON.stringify(between));
      src = src.slice(0, startIdx + "start().catch(err => { console.error(err); process.exit(1); });".length) + src.slice(afterStart);
      console.log('Removed orphan manually');
    }
  }
}

fs.writeFileSync(path, src, 'utf8');

try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) {
  const msg = e.stdout ? e.stdout.toString() : e.message;
  console.log('Still broken:', msg);
}
