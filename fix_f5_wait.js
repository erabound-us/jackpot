const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const old = `      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(F5_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('fantasy5', html);
      break;`;

const neu = `      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(F5_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      // Wait for draw results to render (Vue SPA may need extra time)
      try { await page.waitForSelector('.draw-results-item', { timeout: 10000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('fantasy5', html);
      break;`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('Wait strategy updated at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
