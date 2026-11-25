const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const oldEndpoint = `// Test endpoint: runs Puppeteer scrape for Fantasy 5 without modifying any cache
// GET /test/f5scrape -- returns available dates + scraped numbers for each, read-only
app.get('/test/f5scrape', async (req, res) => {
  const start = Date.now();
  const result = { dates: [], scraped: [], errors: [], memMB: null };
  try {
    const dates = await getAvailableDates('fantasy5');
    result.dates = dates;
    const existing = getFantasy5Draws();
    const existingKeys = new Set(existing.map(d => d.date + '|' + d.drawType));
    for (const date of dates.slice(0, 5)) {
      for (const drawType of ['MIDDAY', 'EVENING']) {
        const normDate = date.replace(/^0/, '').replace(/\\/0/, '/');
        const key = normDate + '|' + drawType;
        const alreadyHave = existing.some(d =>
          (d.date === date || d.date === normDate) && d.drawType === drawType
        );
        try {
          const r = await scrapeFlDraws('fantasy5', date, drawType);
          result.scraped.push({ date, drawType, numbers: r ? r.numbers : null, alreadyInCache: alreadyHave, wouldAppend: !alreadyHave && r && r.numbers && r.numbers.length === 5 });
        } catch(e) {
          result.errors.push({ date, drawType, error: e.message });
        }
      }
    }
    const mem = process.memoryUsage();
    result.memMB = Math.round(mem.rss / 1024 / 1024);
    result.elapsedMs = Date.now() - start;
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message, partial: result });
  }
});`;

const newEndpoint = `// Test endpoint: runs Puppeteer scrape for Fantasy 5 without modifying any cache
// GET /test/f5scrape -- returns available dates + scraped numbers for each, read-only
app.get('/test/f5scrape', async (req, res) => {
  const start = Date.now();
  const result = { dates: [], scraped: [], errors: [], memMB: null };
  try {
    // Use networkidle0 directly here to ensure Vue SPA fully renders
    const F5_URL = 'https://floridalottery.com/games/draw-games/fantasy5';
    let html = '';
    for (let _try = 0; _try < 2; _try++) {
      try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        await page.goto(F5_URL, { waitUntil: 'networkidle0', timeout: 25000 });
        html = await page.content();
        await page.close();
        await closeBrowser();
        break;
      } catch(e) {
        _browser = null;
        if (_try === 1) throw e;
      }
    }
    // Extract article date IDs
    const re = /(\d{4}-\d{2}-\d{2})-fantasy5/g;
    const dates = []; let m;
    while ((m = re.exec(html)) !== null) {
      const [y, mo, day] = m[1].split('-');
      const mmddyyyy = mo + '/' + day + '/' + y;
      if (!dates.includes(mmddyyyy)) dates.push(mmddyyyy);
    }
    result.dates = dates;
    result.htmlSnippet = html.slice(html.indexOf('fantasy5') > 0 ? html.indexOf('fantasy5') - 100 : 0, html.indexOf('fantasy5') + 200);

    const existing = getFantasy5Draws();
    for (const date of dates.slice(0, 5)) {
      for (const drawType of ['MIDDAY', 'EVENING']) {
        const alreadyHave = existing.some(d =>
          (d.date === date || stripLeadingZeros(d.date) === stripLeadingZeros(date)) && d.drawType === drawType
        );
        try {
          const r = await scrapeFlDraws('fantasy5', date, drawType);
          result.scraped.push({ date, drawType, numbers: r ? r.numbers : null, alreadyInCache: alreadyHave, wouldAppend: !alreadyHave && r && r.numbers && r.numbers.length === 5 });
        } catch(e) {
          result.errors.push({ date, drawType, error: e.message });
        }
      }
    }
    const mem = process.memoryUsage();
    result.memMB = Math.round(mem.rss / 1024 / 1024);
    result.elapsedMs = Date.now() - start;
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message, partial: result });
  }
});`;

const idx = src.indexOf(oldEndpoint);
if (idx !== -1) {
  src = src.slice(0, idx) + newEndpoint + src.slice(idx + oldEndpoint.length);
  console.log('Test endpoint updated at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
