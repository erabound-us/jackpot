const puppeteer = require('puppeteer');

async function testPick(game, url, gameId, numDigits) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
  const html = await page.content();
  await browser.close();

  const re = new RegExp('(\\d{4}-\\d{2}-\\d{2})-' + gameId, 'g');
  const dates = []; let m;
  while ((m = re.exec(html)) !== null) { if (!dates.includes(m[1])) dates.push(m[1]); }

  console.log('\n=== ' + game + ' ===');
  console.log('dates:', dates.slice(0,2));

  for (const isoDate of dates.slice(0,1)) {
    const idx = html.indexOf(isoDate + '-' + gameId);
    const chunk = html.slice(idx, idx + 4000);

    // Try to find Midday and Evening sections
    // Pattern: draw-date label with sun/moon icon, then game-numbers block
    // Look for "Midday" and "Evening" text
    const middayIdx = chunk.indexOf('Midday');
    const eveningIdx = chunk.indexOf('Evening');
    console.log('middayIdx:', middayIdx, 'eveningIdx:', eveningIdx);

    // Extract numbers from each section
    for (const [label, startIdx, endIdx] of [
      ['MIDDAY', middayIdx, eveningIdx !== -1 ? eveningIdx : middayIdx + 1000],
      ['EVENING', eveningIdx, eveningIdx + 1000]
    ]) {
      if (startIdx === -1) continue;
      const block = chunk.slice(startIdx, endIdx !== -1 ? endIdx : startIdx + 1000);
      const numRe = /class="game-numbers__number"><span>(\d+)<\/span>/g;
      const nums = []; let nm;
      while ((nm = numRe.exec(block)) !== null) nums.push(parseInt(nm[1]));
      const fbRe = /game-numbers__bonus-text">(\d+)<\/span>/g;
      const fbs = []; let fb;
      while ((fb = fbRe.exec(block)) !== null) fbs.push(parseInt(fb[1]));
      console.log(label + ': digits=' + JSON.stringify(nums) + ' fireball=' + JSON.stringify(fbs));
    }

    // Show raw chunk
    const gnIdx = chunk.indexOf('game-numbers');
    console.log('raw (first 1200):', chunk.slice(gnIdx, gnIdx + 1200));
  }
}

(async () => {
  await testPick('pick2', 'https://floridalottery.com/games/draw-games/pick-2', 'pick2', 2);
  await testPick('pick5', 'https://floridalottery.com/games/draw-games/pick-5', 'pick5', 5);
})().catch(e => console.error(e.message));
