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
    // Strip tags for readability
    const readable = chunk.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style[^>]*>[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    console.log('\n=== ' + name + ' ===');
    console.log('dates:', dates.slice(0,3));
    console.log('readable chunk:', readable.slice(0, 800));
    // Also show raw chunk around game-numbers
    const gnIdx = chunk.indexOf('game-numbers');
    if (gnIdx !== -1) console.log('raw game-numbers area:', chunk.slice(gnIdx, gnIdx + 600));
  }
}

(async () => {
  await probe('lottox', 'https://floridalottery.com/games/draw-games/florida-lotto', 'lotto');
  await probe('cashpop', 'https://floridalottery.com/games/draw-games/cash-pop', 'cashpop');
  await probe('powerball', 'https://floridalottery.com/games/draw-games/powerball', 'powerball');
  await probe('megamillions', 'https://floridalottery.com/games/draw-games/mega-millions', 'megamillions');
})().catch(e => console.error(e.message));
