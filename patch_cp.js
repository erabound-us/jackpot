const fs = require('fs');
let src = fs.readFileSync('server.js', 'utf8');

function replaceAll(old, nw, label) {
  let count = 0;
  while (src.includes(old)) { src = src.replace(old, nw); count++; }
  if (count === 0) console.error('NOT FOUND: ' + label);
  else console.log('Replaced x' + count + ': ' + label);
}

// Replace _appendCpDeltasImpl with Puppeteer scraper
const cpOld = `async function _appendCpDeltasImpl() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_CP).mtimeMs; } catch(e) { return; }
  if (mtime === cpLastPdfMtime) { console.log('CP: PDF unchanged, skipping delta.'); return; }
  const existing = getCpDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
  const jsonMtime = (() => { try { return fs.statSync(CP_DRAWS_PATH).mtimeMs; } catch(e) { return 0; } })();
  if (mtime <= jsonMtime && existing.length > 0) { cpLastPdfMtime = mtime; console.log('CP: PDF older than JSON cache, skipping parse.'); return; }
  let text;
  try { text = await extractPDFText(PDF_PATH_CP); } catch(e) { return; }
  cpLastPdfMtime = mtime;
  const all = parseCashPopHistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('CP: no new draws.'); return; }
  const merged = [...newDraws, ...existing].slice(0, 500);
  cpDrawsCache = merged;
  fs.writeFileSync(CP_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('CP: appended ' + newDraws.length + ' new draws.');
}`;

const cpNew = `async function _appendCpDeltasImpl() {
  console.log('CP: starting Puppeteer scrape...');
  const CP_URL = 'https://floridalottery.com/games/draw-games/cash-pop';
  let html = '';
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(CP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      break;
    } catch(e) {
      console.warn('CP Puppeteer attempt ' + (_try+1) + ' failed:', e.message);
      _browser = null;
      if (_try === 1) { console.log('CP: Puppeteer failed after 2 attempts, skipping.'); return; }
    }
  }
  if (!html) return;
  const dateRe = /([0-9]{4}-[0-9]{2}-[0-9]{2})-cashpop/g;
  const isoDates = []; let dm;
  while ((dm = dateRe.exec(html)) !== null) { if (!isoDates.includes(dm[1])) isoDates.push(dm[1]); }
  if (!isoDates.length) { console.log('CP: no dates found in scraped HTML.'); return; }
  const existing = getCpDraws();
  const existingKeys = new Set(existing.map(d => {
    const p = d.date.split('/'); let yr = p[2]; if (yr.length === 2) yr = '20' + yr;
    return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
  }));
  const newestTs = existing.length ? existing[0].ts : 0;
  const SESSION_NAMES = ['Morning', 'Matinee', 'Afternoon', 'Evening', 'Late Night'];
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts < newestTs - 86400000) continue;
    if (existingKeys.has(isoDate)) continue;
    const articleIdx = html.indexOf(isoDate + '-cashpop');
    if (articleIdx === -1) continue;
    const chunk = html.slice(articleIdx, articleIdx + 6000);
    const sessionRe = /class="text-xs[^"]*"[^>]*>([^<]+)<\/div><span class="game-numbers__number[^"]*">([0-9]+)<\/span>/g;
    const sessions = []; let sm;
    while ((sm = sessionRe.exec(chunk)) !== null) {
      const name = sm[1].trim();
      if (SESSION_NAMES.includes(name)) sessions.push(parseInt(sm[2]));
    }
    // Only store complete days (all 5 sessions) to match existing cache structure
    // For today (partial day), skip -- will be picked up in next scheduled refresh
    if (sessions.length === 5) {
      const mmddyyyy = mo + '/' + day + '/' + y;
      newDraws.push({ date: mmddyyyy, numbers: sessions, ts });
    } else if (sessions.length > 0 && ts < newestTs) {
      // Partial day older than newest -- store what we have padded to avoid gaps
      const mmddyyyy = mo + '/' + day + '/' + y;
      newDraws.push({ date: mmddyyyy, numbers: sessions, ts });
    }
  }
  if (!newDraws.length) { console.log('CP: no new draws found via Puppeteer.'); return; }
  newDraws.sort((a, b) => b.ts - a.ts);
  const merged = newDraws.concat(existing).slice(0, 500);
  cpDrawsCache = merged;
  fs.writeFileSync(CP_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('CP: appended ' + newDraws.length + ' new draw(s) via Puppeteer. Total: ' + merged.length);
}`;

// Replace CP schedule entries (PDF download -> direct appendCpDeltas)
const cpSchedOld1 = `enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => { lastAutoRefreshCP = null; cpDrawsCache = null; return appendCpDeltas(); }).catch(() => {}));`;
const cpSchedNew1 = `enqueueRefresh('cashpop', () => appendCpDeltas().catch(() => {}));`;

// Replace /refresh/cashpop route
const cpRefreshOld = `enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => {
    lastAutoRefreshCP = null;
    cpDrawsCache = null;
  }).then(() => appendCpDeltas()).catch(() => {}));`;
const cpRefreshNew = `enqueueRefresh('cashpop', () => appendCpDeltas().catch(() => {}));`;

// Replace startup CP download
const cpStartOld = `    // Cash Pop still uses PDF -- download on startup for delta detection
    downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => appendCpDeltas()).catch(() => {});`;
const cpStartNew = `    // All games now use Puppeteer -- no startup PDF downloads needed`;

// Replace ensureDailyRefreshCP
const cpEnsureOld = `async function ensureDailyRefreshCP() {
  const today = todayET();
  if (lastAutoRefreshCP === today) return;
  if (autoRefreshCPPromise) return autoRefreshCPPromise;
  autoRefreshCPPromise = downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => {
    lastAutoRefreshCP = today;
    autoRefreshCPPromise = null;
    console.log('Auto-refreshed Cash Pop PDF for ' + today);
    cpDrawsCache = null;
    return appendCpDeltas();
  }).catch(err => {
    autoRefreshCPPromise = null;
    console.warn('Cash Pop auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshCPPromise;
}`;
const cpEnsureNew = `async function ensureDailyRefreshCP() {}`;

replaceAll(cpOld, cpNew, 'CP delta impl');
replaceAll(cpSchedOld1, cpSchedNew1, 'CP schedule entries');
replaceAll(cpRefreshOld, cpRefreshNew, 'CP /refresh route');
replaceAll(cpStartOld, cpStartNew, 'CP startup download');
replaceAll(cpEnsureOld, cpEnsureNew, 'CP ensureDailyRefresh');

fs.writeFileSync('server.js', src);
console.log('Done.');
