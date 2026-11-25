const puppeteer = require('puppeteer');

async function probe(name, url, gameId) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
  const html = await page.content();
  await browser.close();

  const re = new RegExp('(\\d{4}-\\d{2}-\\d{2})-' + gameId, 'g');
  const dates = []; let m;
  while ((m = re.exec(html)) !== null) { if (!dates.includes(m[1])) dates.push(m[1]); }

  if (dates[0]) {
    const idx = html.indexOf(dates[0] + '-' + gameId);
    const chunk = html.slice(idx, idx + 3000);
    const readable = chunk.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    console.log('\n=== ' + name + ' ===');
    console.log('dates:', dates.slice(0,2));
    console.log('readable:', readable.slice(0, 600));
    const gnIdx = chunk.indexOf('game-numbers');
    if (gnIdx !== -1) console.log('raw:', chunk.slice(gnIdx, gnIdx + 800));
  } else {
    console.log('\n=== ' + name + ' === NO DATES FOUND, htmlLen=' + html.length);
    // Check what article IDs exist
    const anyArticle = html.match(/\d{4}-\d{2}-\d{2}-[a-z0-9-]+/g);
    if (anyArticle) console.log('sample article IDs:', [...new Set(anyArticle)].slice(0,5));
  }
}

(async () => {
  await probe('pick2', 'https://floridalottery.com/games/draw-games/pick-2', 'pick2');
  await probe('pick3', 'https://floridalottery.com/games/draw-games/pick-3', 'pick3');
})().catch(e => console.error(e.message));
