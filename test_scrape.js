const puppeteer = require('puppeteer');

const GAMES = [
  { name: 'jtp',          url: 'https://floridalottery.com/games/draw-games/jackpot-triple-play', id: 'jackpottripleplay', nums: 6 },
  { name: 'lottox',       url: 'https://floridalottery.com/games/draw-games/florida-lotto',       id: 'lotto',            nums: 6 },
  { name: 'cashpop',      url: 'https://floridalottery.com/games/draw-games/cash-pop',            id: 'cashpop',          nums: 1 },
  { name: 'powerball',    url: 'https://floridalottery.com/games/draw-games/powerball',           id: 'powerball',        nums: 6 },
  { name: 'megamillions', url: 'https://floridalottery.com/games/draw-games/mega-millions',       id: 'megamillions',     nums: 6 },
];

(async () => {
  for (const g of GAMES) {
    try {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
      const page = await browser.newPage();
      await page.goto(g.url, { waitUntil: 'networkidle0', timeout: 30000 });
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
      const html = await page.content();
      await browser.close();

      const re = new RegExp('(\\d{4}-\\d{2}-\\d{2})-' + g.id, 'g');
      const dates = []; let m;
      while ((m = re.exec(html)) !== null) { if (!dates.includes(m[1])) dates.push(m[1]); }

      const results = [];
      for (const d of dates.slice(0, 3)) {
        const idx = html.indexOf(d + '-' + g.id);
        if (idx === -1) { results.push({ date: d, nums: [], note: 'article not found' }); continue; }
        const chunk = html.slice(idx, idx + 2000);
        const numRe = /class="game-numbers__number"><span>(\d+)<\/span>/g;
        const nums = []; let nm;
        while ((nm = numRe.exec(chunk)) !== null) nums.push(parseInt(nm[1]));
        results.push({ date: d, nums });
      }

      console.log(g.name + ': dates=' + JSON.stringify(dates.slice(0,3)) + ' results=' + JSON.stringify(results) + ' htmlLen=' + html.length + ' mem=' + Math.round(process.memoryUsage().rss/1024/1024) + 'MB');
    } catch(e) {
      console.log(g.name + ': ERROR ' + e.message);
    }
  }
})();
