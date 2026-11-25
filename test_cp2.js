const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto('https://floridalottery.com/games/draw-games/cash-pop', { waitUntil: 'networkidle0', timeout: 30000 });
  try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
  const html = await page.content();
  await browser.close();

  // Find all cashpop article IDs
  const re = /(\d{4}-\d{2}-\d{2})-cashpop/g;
  const dates = []; let m;
  while ((m = re.exec(html)) !== null) { if (!dates.includes(m[1])) dates.push(m[1]); }
  console.log('dates:', dates.slice(0,3));

  // For the most recent date, show a larger chunk to see all sessions
  if (dates[0]) {
    const idx = html.indexOf(dates[0] + '-cashpop');
    const chunk = html.slice(idx, idx + 6000);
    // Find all session names
    const sessionRe = /class="text-xs[^"]*"[^>]*>([^<]+)<\/div><span class="game-numbers__number[^"]*">(\d+)<\/span>/g;
    const sessions = []; let sm;
    while ((sm = sessionRe.exec(chunk)) !== null) sessions.push({ name: sm[1].trim(), number: parseInt(sm[2]) });
    console.log('sessions in article:', sessions);
    // Also check the draw details table (expanded panel)
    const tableRe = /Drawing Winning Number[^<]*<\/[^>]+>([\s\S]{0,2000})/;
    const tableM = chunk.match(tableRe);
    if (tableM) {
      const readable = tableM[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500);
      console.log('table data:', readable);
    }
    // Show raw chunk readable
    const readable = chunk.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,800);
    console.log('readable:', readable);
  }
})().catch(e => console.error(e.message));
