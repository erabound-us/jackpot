const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');

// ── PB replacement ────────────────────────────────────────────────────────────
const pbOld = `async function _appendPbDeltasImpl() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_PB).mtimeMs; } catch(e) { return; }
  if (mtime === pbLastPdfMtime) { console.log('PB: PDF unchanged, skipping delta.'); return; }
  const existing = getPbDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
  const jsonMtime = (() => { try { return fs.statSync(PB_DRAWS_PATH).mtimeMs; } catch(e) { return 0; } })();
  if (mtime <= jsonMtime && existing.length > 0) { pbLastPdfMtime = mtime; console.log('PB: PDF older than JSON cache, skipping parse.'); return; }
  let text;
  try { text = await extractPDFText(PDF_PATH_PB); } catch(e) { return; }
  pbLastPdfMtime = mtime;
  const all = parsePbHistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('PB: no new draws.'); return; }
  const merged = [...newDraws, ...existing].slice(0, 500);
  pbDrawsCache = merged;
  fs.writeFileSync(PB_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('PB: appended ' + newDraws.length + ' new draws.');
}`;

const pbNew = `async function _appendPbDeltasImpl() {
  console.log('PB: starting Puppeteer scrape...');
  const PB_URL = 'https://floridalottery.com/games/draw-games/powerball';
  let html = '';
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(PB_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('powerball', html);
      break;
    } catch(e) {
      console.warn('PB Puppeteer attempt ' + (_try+1) + ' failed:', e.message);
      _browser = null;
      if (_try === 1) { console.log('PB: Puppeteer failed after 2 attempts, skipping.'); return; }
    }
  }
  if (!html) return;
  const dateRe = /([0-9]{4}-[0-9]{2}-[0-9]{2})-powerball-item/g;
  const isoDates = []; let dm;
  while ((dm = dateRe.exec(html)) !== null) { if (!isoDates.includes(dm[1])) isoDates.push(dm[1]); }
  if (!isoDates.length) { console.log('PB: no dates found in scraped HTML.'); return; }
  const existing = getPbDraws();
  const existingKeys = new Set(existing.map(d => {
    const p = d.date.split('/'); let yr = p[2]; if (yr.length === 2) yr = '20' + yr;
    return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
  }));
  const newestTs = existing.length ? existing[0].ts : 0;
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts < newestTs - 86400000) continue;
    if (existingKeys.has(isoDate)) continue;
    const articleIdx = html.indexOf(isoDate + '-powerball-item');
    if (articleIdx === -1) continue;
    const chunk = html.slice(articleIdx, articleIdx + 2000);
    const dpIdx = chunk.indexOf('Double Play');
    const mainChunk = dpIdx !== -1 ? chunk.slice(0, dpIdx) : chunk;
    const numRe = /class="game-numbers__number"><span>([0-9]+)<\/span>/g;
    const nums = []; let nm;
    while ((nm = numRe.exec(mainChunk)) !== null) nums.push(parseInt(nm[1]));
    const pbM = mainChunk.match(/game-numbers__bonus-text">([0-9]+)<\/span>/);
    const white = nums.slice(0, 5).filter(n => n >= 1 && n <= 69);
    const pb = pbM ? parseInt(pbM[1]) : null;
    if (white.length === 5 && pb !== null && pb >= 1 && pb <= 26) {
      const mmddyyyy = mo + '/' + day + '/' + y;
      newDraws.push({ date: mmddyyyy, numbers: white, powerball: pb, ts });
    }
  }
  if (!newDraws.length) { console.log('PB: no new draws found via Puppeteer.'); return; }
  newDraws.sort((a, b) => b.ts - a.ts);
  const merged = newDraws.concat(existing).slice(0, 500);
  pbDrawsCache = merged;
  fs.writeFileSync(PB_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('PB: appended ' + newDraws.length + ' new draw(s) via Puppeteer. Total: ' + merged.length);
}`;

// ── MM replacement ────────────────────────────────────────────────────────────
const mmOld = `async function _appendMmDeltasImpl() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_MM).mtimeMs; } catch(e) { return; }
  if (mtime === mmLastPdfMtime) { console.log('MM: PDF unchanged, skipping delta.'); return; }
  const existing = getMmDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
  const jsonMtime = (() => { try { return fs.statSync(MM_DRAWS_PATH).mtimeMs; } catch(e) { return 0; } })();
  if (mtime <= jsonMtime && existing.length > 0) { mmLastPdfMtime = mtime; console.log('MM: PDF older than JSON cache, skipping parse.'); return; }
  let text;
  try { text = await extractPDFText(PDF_PATH_MM); } catch(e) { return; }
  mmLastPdfMtime = mtime;
  const all = parseMmHistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('MM: no new draws in PDF.'); return; }
  const merged = [...newDraws, ...existing].slice(0, 500);
  mmDrawsCache = merged;
  fs.writeFileSync(MM_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('MM: appended ' + newDraws.length + ' new draw(s). Total: ' + merged.length);
}`;

const mmNew = `async function _appendMmDeltasImpl() {
  console.log('MM: starting Puppeteer scrape...');
  const MM_URL = 'https://floridalottery.com/games/draw-games/mega-millions';
  let html = '';
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(MM_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot('megamillions', html);
      break;
    } catch(e) {
      console.warn('MM Puppeteer attempt ' + (_try+1) + ' failed:', e.message);
      _browser = null;
      if (_try === 1) { console.log('MM: Puppeteer failed after 2 attempts, skipping.'); return; }
    }
  }
  if (!html) return;
  const dateRe = /([0-9]{4}-[0-9]{2}-[0-9]{2})-megamillions-item/g;
  const isoDates = []; let dm;
  while ((dm = dateRe.exec(html)) !== null) { if (!isoDates.includes(dm[1])) isoDates.push(dm[1]); }
  if (!isoDates.length) { console.log('MM: no dates found in scraped HTML.'); return; }
  const existing = getMmDraws();
  const existingKeys = new Set(existing.map(d => {
    const p = d.date.split('/'); let yr = p[2]; if (yr.length === 2) yr = '20' + yr;
    return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
  }));
  const newestTs = existing.length ? existing[0].ts : 0;
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts < newestTs - 86400000) continue;
    if (existingKeys.has(isoDate)) continue;
    const articleIdx = html.indexOf(isoDate + '-megamillions-item');
    if (articleIdx === -1) continue;
    const chunk = html.slice(articleIdx, articleIdx + 2000);
    const numRe = /class="game-numbers__number"><span>([0-9]+)<\/span>/g;
    const nums = []; let nm;
    while ((nm = numRe.exec(chunk)) !== null) nums.push(parseInt(nm[1]));
    const mbM = chunk.match(/game-numbers__bonus-text">([0-9]+)<\/span>/);
    const white = nums.slice(0, 5).filter(n => n >= 1 && n <= 70);
    const mb = mbM ? parseInt(mbM[1]) : null;
    if (white.length === 5 && mb !== null && mb >= 1 && mb <= 25) {
      const mmddyyyy = mo + '/' + day + '/' + y;
      newDraws.push({ date: mmddyyyy, numbers: white, megaball: mb, ts });
    }
  }
  if (!newDraws.length) { console.log('MM: no new draws found via Puppeteer.'); return; }
  newDraws.sort((a, b) => b.ts - a.ts);
  const merged = newDraws.concat(existing).slice(0, 500);
  mmDrawsCache = merged;
  fs.writeFileSync(MM_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('MM: appended ' + newDraws.length + ' new draw(s) via Puppeteer. Total: ' + merged.length);
}`;

// ── Pick replacement ──────────────────────────────────────────────────────────
const pickOld = `async function _appendPickDeltasImpl(game) {
  const pdfPath = PDF_PATHS_PICK[game];
  let mtime;
  try { mtime = fs.statSync(pdfPath).mtimeMs; } catch(e) { return; }
  if (mtime === pickLastPdfMtime[game]) { console.log(game + ': PDF unchanged, skipping delta.'); return; }
  const existing = getPickDraws(game);
  const newestTs = existing.length ? existing[0].ts : 0;
  // Skip full parse if PDF is older than our newest cached draw -- nothing new to find
  const jsonMtime = (() => { try { return fs.statSync(PICK_DRAWS_PATHS[game]).mtimeMs; } catch(e) { return 0; } })();
  if (mtime <= jsonMtime && existing.length > 0) { pickLastPdfMtime[game] = mtime; console.log(game + ': PDF older than JSON cache, skipping parse.'); return; }
  let text;
  try { text = await getPickText(game); } catch(e) { return; }
  pickLastPdfMtime[game] = mtime;
  const numDigits = parseInt(game.replace('pick', ''));
  const all = parsePickHistoryPDF(text, numDigits);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log(game + ': no new draws.'); return; }
  const merged = [...newDraws, ...existing].slice(0, 500);
  pickDrawsCache[game] = merged;
  fs.writeFileSync(PICK_DRAWS_PATHS[game], JSON.stringify(merged, null, 2));
  console.log(game + ': appended ' + newDraws.length + ' new draws.');
}`;

const PICK_GAME_IDS = { pick2: 'pick2', pick3: 'pick3', pick4: 'pick4', pick5: 'pick5' };
const pickNew = `async function _appendPickDeltasImpl(game) {
  const PICK_URLS = {
    pick2: 'https://floridalottery.com/games/draw-games/pick-2',
    pick3: 'https://floridalottery.com/games/draw-games/pick-3',
    pick4: 'https://floridalottery.com/games/draw-games/pick-4',
    pick5: 'https://floridalottery.com/games/draw-games/pick-5',
  };
  const url = PICK_URLS[game];
  if (!url) return;
  console.log(game + ': starting Puppeteer scrape...');
  let html = '';
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      try { await page.waitForSelector('.draw-results-item', { timeout: 15000 }); } catch(_) {}
      html = await page.content();
      await page.close();
      await closeBrowser();
      break;
    } catch(e) {
      console.warn(game + ' Puppeteer attempt ' + (_try+1) + ' failed:', e.message);
      _browser = null;
      if (_try === 1) { console.log(game + ': Puppeteer failed after 2 attempts, skipping.'); return; }
    }
  }
  if (!html) return;
  const dateRe = new RegExp('([0-9]{4}-[0-9]{2}-[0-9]{2})-' + game + '-item', 'g');
  const isoDates = []; let dm;
  while ((dm = dateRe.exec(html)) !== null) { if (!isoDates.includes(dm[1])) isoDates.push(dm[1]); }
  if (!isoDates.length) { console.log(game + ': no dates found in scraped HTML.'); return; }
  const existing = getPickDraws(game);
  const existingKeys = new Set(existing.map(d => {
    const p = d.date.split('/'); let yr = p[2]; if (yr.length === 2) yr = '20' + yr;
    return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0') + '|' + d.drawType;
  }));
  const newestTs = existing.length ? existing[0].ts : 0;
  const numDigits = parseInt(game.replace('pick', ''));
  const newDraws = [];
  for (const isoDate of isoDates) {
    const [y, mo, day] = isoDate.split('-');
    const ts = new Date(parseInt(y), parseInt(mo) - 1, parseInt(day)).getTime();
    if (ts < newestTs - 86400000) continue;
    const articleIdx = html.indexOf(isoDate + '-' + game + '-item');
    if (articleIdx === -1) continue;
    const chunk = html.slice(articleIdx, articleIdx + 4000);
    const mmddyyyy = mo + '/' + day + '/' + y;
    for (const drawType of ['MIDDAY', 'EVENING']) {
      const drawKey = isoDate + '|' + drawType;
      if (existingKeys.has(drawKey)) continue;
      const label = drawType === 'MIDDAY' ? 'Midday' : 'Evening';
      const otherLabel = drawType === 'MIDDAY' ? 'Evening' : 'Midday';
      const dtIdx = chunk.indexOf(label);
      if (dtIdx === -1) continue;
      const otherIdx = chunk.indexOf(otherLabel, dtIdx + label.length);
      const block = chunk.slice(dtIdx, otherIdx !== -1 ? otherIdx : dtIdx + 1000);
      const numRe = /class="game-numbers__number"><span>([0-9]+)<\\/span>/g;
      const digits = []; let nm;
      while ((nm = numRe.exec(block)) !== null) digits.push(parseInt(nm[1]));
      const fbM = block.match(/game-numbers__bonus-text">([0-9]+)<\\/span>/);
      const fireball = fbM ? parseInt(fbM[1]) : 0;
      if (digits.length === numDigits) {
        const drawTs = ts + (drawType === 'EVENING' ? 1 : 0);
        newDraws.push({ date: mmddyyyy, drawType, digits, fireball, ts: drawTs });
      }
    }
  }
  if (!newDraws.length) { console.log(game + ': no new draws found via Puppeteer.'); return; }
  newDraws.sort((a, b) => b.ts - a.ts);
  const merged = newDraws.concat(existing).slice(0, 500);
  pickDrawsCache[game] = merged;
  fs.writeFileSync(PICK_DRAWS_PATHS[game], JSON.stringify(merged, null, 2));
  console.log(game + ': appended ' + newDraws.length + ' new draw(s) via Puppeteer. Total: ' + merged.length);
}`;

let out = src;

function replace(old, nw, label) {
  const idx = out.indexOf(old);
  if (idx === -1) { console.error('NOT FOUND: ' + label); process.exit(1); }
  out = out.slice(0, idx) + nw + out.slice(idx + old.length);
  console.log('Replaced: ' + label);
}

replace(pbOld, pbNew, 'PB');
replace(mmOld, mmNew, 'MM');
replace(pickOld, pickNew, 'Pick');

fs.writeFileSync('server.js', out);
console.log('Done. server.js updated.');
