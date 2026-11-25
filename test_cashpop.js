const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto('https://floridalottery.com/games/draw-games/cash-pop', { waitUntil: 'networkidle0', timeout: 30000 });
  try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
  const html = await page.content();
  await browser.close();

  const re = /(\d{4}-\d{2}-\d{2})-cashpop/g;
  const dates = []; let m;
  while ((m = re.exec(html)) !== null) { if (!dates.includes(m[1])) dates.push(m[1]); }
  console.log('dates:', dates.slice(0,3));

  if (dates[0]) {
    const idx = html.indexOf(dates[0] + '-cashpop');
    const chunk = html.slice(idx, idx + 4000);
    // Find all session names and numbers
    // Pattern: session name in <div class="text-xs...">Morning</div> then <span class="game-numbers__number...">5</span>
    const sessionRe = /class="text-xs[^"]*"[^>]*>([^<]+)<\/div><span class="game-numbers__number[^"]*">(\d+)<\/span>/g;
    const sessions = []; let sm;
    while ((sm = sessionRe.exec(chunk)) !== null) {
      sessions.push({ name: sm[1].trim(), number: parseInt(sm[2]) });
    }
    console.log('sessions:', sessions);
    // Also try simpler pattern
    const simpleRe = /game-numbers__number[^>]*>(\d+)<\/span>/g;
    const nums = []; let nm;
    while ((nm = simpleRe.exec(chunk)) !== null) nums.push(parseInt(nm[1]));
    console.log('all nums:', nums);
    // Show raw chunk
    const gnIdx = chunk.indexOf('game-numbers');
    console.log('raw:', chunk.slice(gnIdx, gnIdx + 1000));
  }
})().catch(e => console.error(e.message));
