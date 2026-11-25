const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

function sr(src, old, neu, label) {
  const idx = src.indexOf(old);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'replaced at idx', idx);
  return src.slice(0, idx) + neu + src.slice(idx + old.length);
}

// 1. Replace _appendFantasy5DeltasImpl with Puppeteer version
src = sr(src,
  `async function _appendFantasy5DeltasImpl() {

  let mtime;
  try { mtime = fs.statSync(PDF_PATH_F5).mtimeMs; } catch(e) { return; }

  if (mtime === f5LastPdfMtime) { console.log('Fantasy 5: PDF unchanged, skipping parse.'); return; }
  const existing = getFantasy5Draws();

  const newestTs = existing.length ? existing[0].ts : 0;

  // Skip full parse if PDF is older than our newest cached draw -- nothing new to find

  const jsonMtime = (() => { try { return fs.statSync(JSON_PATH_F5).mtimeMs; } catch(e) { return 0; } })();

  if (mtime <= jsonMtime && existing.length > 0) { f5LastPdfMtime = mtime; console.log('Fantasy 5: PDF older than JSON cache, skipping parse.'); return; }
  let text;

  try { text = await extractPDFText(PDF_PATH_F5); } catch(e) { return; }

  f5LastPdfMtime = mtime;

  const all = parseFantasy5HistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);

  if (!newDraws.length) { console.log('Fantasy 5: no new draws in PDF.'); return; }

  const merged = newDraws.concat(existing).slice(0, 500);
  f5DrawsCache = merged;

  fs.writeFileSync(JSON_PATH_F5, JSON.stringify(merged, null, 2));

  console.log('Fantasy 5: appended ' + newDraws.length + ' new draw(s). Total: ' + merged.length);
}`,

  `async function _appendFantasy5DeltasImpl() {
  // Puppeteer-based: scrape FL Lottery website directly, no PDF parse
  // One Chrome launch gets all recent dates; ~20s, ~108MB RSS vs 2.5min/535MB for PDF
  console.log('Fantasy 5: starting Puppeteer scrape...');
  const F5_URL = 'https://floridalottery.com/games/draw-games/fantasy5';
  let html = '';
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(F5_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('fantasy5', html);
      break;
    } catch(e) {
      console.warn('Fantasy 5 Puppeteer attempt ' + (_try+1) + ' failed:', e.message);
      _browser = null;
      if (_try === 1) { console.log('Fantasy 5: Puppeteer failed after 2 attempts, skipping.'); return; }
    }
  }
  if (!html) return;

  // Extract article date IDs from rendered HTML
  const dateRe = /(\d{4}-\d{2}-\d{2})-fantasy5/g;
  const isoDates = []; let dm;
  while ((dm = dateRe.exec(html)) !== null) {
    if (!isoDates.includes(dm[1])) isoDates.push(dm[1]);
  }
  if (!isoDates.length) { console.log('Fantasy 5: no dates found in scraped HTML.'); return; }

  const existing = getFantasy5Draws();
  const newestTs = existing.length ? existing[0].ts : 0;
  const newDraws = [];

  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts <= newestTs) continue; // already have this date

    const articleIdx = html.indexOf(isoDate + '-fantasy5');
    if (articleIdx === -1) continue;
    const chunk = html.slice(articleIdx, articleIdx + 4000);
    const mmddyyyy = mo + '/' + day + '/' + y;

    for (const drawType of ['MIDDAY', 'EVENING']) {
      const dtLabel = drawType === 'MIDDAY' ? 'Midday' : 'Evening';
      const otherLabel = drawType === 'MIDDAY' ? 'Evening' : 'Midday';
      const dtIdx = chunk.indexOf(dtLabel);
      if (dtIdx === -1) continue;
      const otherIdx = chunk.indexOf(otherLabel, dtIdx + dtLabel.length);
      const block = chunk.slice(dtIdx, otherIdx !== -1 ? otherIdx : dtIdx + 600);
      const numRe = /class="game-numbers__number"><span>(\d+)<\/span>/g;
      const nums = []; let nm;
      while ((nm = numRe.exec(block)) !== null) nums.push(parseInt(nm[1]));
      if (nums.length === 5) {
        newDraws.push({ date: mmddyyyy, drawType, numbers: nums, ts: ts + (drawType === 'EVENING' ? 1 : 0) });
      }
    }
  }

  if (!newDraws.length) { console.log('Fantasy 5: no new draws found via Puppeteer.'); return; }

  newDraws.sort((a, b) => b.ts - a.ts);
  const merged = newDraws.concat(existing).slice(0, 500);
  f5DrawsCache = merged;
  fs.writeFileSync(JSON_PATH_F5, JSON.stringify(merged, null, 2));
  console.log('Fantasy 5: appended ' + newDraws.length + ' new draw(s) via Puppeteer. Total: ' + merged.length);
}`,
  'appendFantasy5DeltasImpl'
);

// 2. Replace all 3 schedule wiring points - remove PDF download, call appendFantasy5Deltas directly
// Primary schedule (f5Times)
src = sr(src,
  `enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Post-draw refresh queued: Fantasy 5');
  }));`,
  `enqueueRefresh('fantasy5', () => appendFantasy5Deltas().catch(() => {}));
    console.log('Post-draw refresh queued: Fantasy 5');
  }));`,
  'schedule primary'
);

// Midday retry (13:25)
src = sr(src,
  `enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Post-draw midday retry queued: Fantasy 5');`,
  `enqueueRefresh('fantasy5', () => appendFantasy5Deltas().catch(() => {}));
    console.log('Post-draw midday retry queued: Fantasy 5');`,
  'schedule midday retry'
);

// Evening retry (23:35)
src = sr(src,
  `enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));

    console.log('Post-draw evening retry queued: Fantasy 5');`,
  `enqueueRefresh('fantasy5', () => appendFantasy5Deltas().catch(() => {}));
    console.log('Post-draw evening retry queued: Fantasy 5');`,
  'schedule evening retry'
);

// 3. Also update /refresh/fantasy5 route to not download PDF first
src = sr(src,
  `lastAutoRefreshF5 = null; return appendFantasy5Deltas();`,
  `return appendFantasy5Deltas();`,
  'refresh route'
);

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
