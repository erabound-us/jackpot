const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const old = `      // Wait for draw results to render (Vue SPA may need extra time)
      try { await page.waitForSelector('.draw-results-item', { timeout: 10000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('fantasy5', html);
      break;`;

const neu = `      // Wait for draw results to render (Vue SPA may need extra time)
      let selectorFound = false;
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); selectorFound = true; } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      console.log('Fantasy 5: HTML length=' + html.length + ' selectorFound=' + selectorFound + ' hasArticleId=' + /\\d{4}-\\d{2}-\\d{2}-fantasy5/.test(html));
      extractAndCacheJackpot('fantasy5', html);
      break;`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('Logging added at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
