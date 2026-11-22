const express = require('express');
const PDFParser = require('pdf2json');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const https = require('https');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');

const app = express();

// ── Rate limiting (protects public endpoint) ─────────────────────────────────────────────────────

const rateLimits = new Map();
const blacklist = new Map(); // ip -> expiry timestamp
const strikes = new Map();  // ip -> { count, start }
const RATE_WINDOW = 60 * 1000;
const STRIKE_WINDOW = 10 * 60 * 1000;  // 10 min strike accumulation window
const STRIKE_LIMIT = 5;                // bans after 5 rate-limit hits
const BAN_DURATION = 24 * 60 * 60 * 1000; // 24 hour ban
const RATE_LIMITS = {
  '/analyze': 10,
  '/refresh': 3,
  '/email':   5,
  '/check':   20,
  '/chat':    30,
};
const GLOBAL_LIMIT = 120;

function rateLimit(req, res, next) {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  const now = Date.now();

  // Blacklist check -- reject immediately
  const banExpiry = blacklist.get(ip);
  if (banExpiry) {
    if (now < banExpiry) return res.status(403).json({ error: 'Access denied.' });
    blacklist.delete(ip);
    console.log('Blacklist expired for ' + ip);
  }

  function strike() {
    const s = strikes.get(ip) || { count: 0, start: now };
    if (now - s.start > STRIKE_WINDOW) { s.count = 0; s.start = now; }
    s.count++;
    strikes.set(ip, s);
    if (s.count >= STRIKE_LIMIT) {
      blacklist.set(ip, now + BAN_DURATION);
      strikes.delete(ip);
      console.log('Blacklisted ' + ip + ' for 24h after ' + STRIKE_LIMIT + ' strikes');
    }
  }

  // Exclude pure read endpoints from per-route AND global rate limits
  if (req.path.startsWith('/nextdraw') || req.path.startsWith('/latestdraw') || req.path === '/refresh/status' || req.path === '/health' || req.path === '/jackpot') return next();

  // Global cap
  const gKey = ip + '__global';
  const gEntry = rateLimits.get(gKey) || { count: 0, start: now };
  if (now - gEntry.start > RATE_WINDOW) { gEntry.count = 0; gEntry.start = now; }
  gEntry.count++;
  rateLimits.set(gKey, gEntry);
  if (gEntry.count > GLOBAL_LIMIT) { strike(); return res.status(429).json({ error: 'Too many requests. Please wait a moment.' }); }

  // Per-route cap
  const route = Object.keys(RATE_LIMITS).find(r => req.path.startsWith(r));
  if (!route) return next();
  const key = ip + route;
  const entry = rateLimits.get(key) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimits.set(key, entry);
  if (entry.count > RATE_LIMITS[route]) { strike(); return res.status(429).json({ error: 'Too many requests. Please wait a moment.' }); }

  next();
}

app.use(rateLimit);
app.use(express.json({ limit: '20kb' }));

// Startup readiness gate -- returns 503 on non-health routes until PDF caches are warm
let _serverReady = false;
app.use((req, res, next) => {
  if (_serverReady || req.path === '/health') return next();
  res.set('Cache-Control', 'no-store').status(503).json({ error: 'Server warming up. Try again in a moment.' });
});

// Prevent all API responses from being cached by browsers or proxies
app.use((req, res, next) => {
  if (req.path !== '/') res.set('Cache-Control', 'no-store');
  next();
});

// Clean up rate limit, strike, and blacklist maps every 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW;
  for (const [k, v] of rateLimits) { if (v.start < cutoff) rateLimits.delete(k); }
  for (const [k, v] of strikes) { if (now - v.start > STRIKE_WINDOW) strikes.delete(k); }
  for (const [k, v] of blacklist) { if (now > v) { blacklist.delete(k); console.log('Blacklist expired for ' + k); } }
}, 5 * 60 * 1000);

// ── PDF URLs ──────────────────────────────────────────────────────────────────

const PDF_URLS = {
  history:   'https://files.floridalottery.com/exptkt/jtp.pdf',
  frequency: 'https://files.floridalottery.com/exptkt/jackpot-triple-play_number-frequency-chart.pdf'
};
const PDF_PATHS = {
  history:   path.join(__dirname, 'jtp.pdf'),
  frequency: path.join(__dirname, 'jackpot-triple-play_number-frequency-chart.pdf')
};
const PDF_URLS_LX = 'https://files.floridalottery.com/exptkt/lotto_winning-numbers-history.pdf';
const PDF_PATH_LX = path.join(__dirname, 'lotto_winning-numbers-history.pdf');
const PDF_URL_F5  = 'https://files.floridalottery.com/exptkt/fantasy5_winning-numbers-history.pdf';
const PDF_PATH_F5 = path.join(__dirname, 'fantasy5_winning-numbers-history.pdf');
const PDF_URL_CP  = 'https://files.floridalottery.com/exptkt/cash-pop_winning-numbers-history.pdf';
const PDF_PATH_CP = path.join(__dirname, 'cash-pop_winning-numbers-history.pdf');
const PDF_URLS_PICK = {
  pick2: 'https://files.floridalottery.com/exptkt/pick2_winning-numbers-history.pdf',
  pick3: 'https://files.floridalottery.com/exptkt/pick3_winning-numbers-history.pdf',
  pick4: 'https://files.floridalottery.com/exptkt/pick4_winning-numbers-history.pdf',
  pick5: 'https://files.floridalottery.com/exptkt/pick5_winning-numbers-history.pdf',
};
const PDF_PATHS_PICK = {
  pick2: path.join(__dirname, 'pick2_winning-numbers-history.pdf'),
  pick3: path.join(__dirname, 'pick3_winning-numbers-history.pdf'),
  pick4: path.join(__dirname, 'pick4_winning-numbers-history.pdf'),
  pick5: path.join(__dirname, 'pick5_winning-numbers-history.pdf'),
};
const PDF_URL_PB  = 'https://files.floridalottery.com/exptkt/powerball_winning-numbers-history.pdf';
const PDF_PATH_PB = path.join(__dirname, 'powerball_winning-numbers-history.pdf');
const PDF_URL_MM  = 'https://files.floridalottery.com/exptkt/mega-millions_winning-numbers-history.pdf';
const PDF_PATH_MM = path.join(__dirname, 'mega-millions_winning-numbers-history.pdf');

// ── Per-user session state ─────────────────────────────────────────────────────────────────────────────
// Each browser gets a random session ID. Sessions expire after 2 hours of inactivity.

const SESSION_TTL = 2 * 60 * 60 * 1000;
const sessions = new Map();

function getSession(id) {
  const now = Date.now();
  let sess = sessions.get(id);
  if (!sess) { sess = { lines: new Set(), lastSeen: now }; sessions.set(id, sess); }
  else sess.lastSeen = now;
  return sess;
}

function clearSession(id) { if (id) sessions.delete(id); }

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  let purged = 0;
  for (const [id, sess] of sessions) { if (sess.lastSeen < cutoff) { sessions.delete(id); purged++; } }
  if (purged) console.log('Purged ' + purged + ' expired sessions. Active: ' + sessions.size);
}, 30 * 60 * 1000);

// ── PDF download ──────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    https.get(`${url}?_=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }, res => {
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(tmp, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.rename(tmp, dest, err => err ? reject(err) : resolve());
      });
    }).on('error', err => { file.close(); fs.unlink(tmp, () => {}); reject(err); });
  });
}

async function downloadPDFs() {
  const results = {};
  for (const [key, url] of Object.entries(PDF_URLS)) {
    try { await downloadFile(url, PDF_PATHS[key]); results[key] = 'ok'; }
    catch (e) { results[key] = e.message; }
  }
  await Promise.all([
    downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { results.lottox  = 'ok'; lxDrawsCache = null; }).catch(e => { results.lottox  = e.message; }),
    downloadFile(PDF_URL_F5,  PDF_PATH_F5).then(() => { results.fantasy5 = 'ok'; f5DrawsCache = null; }).catch(e => { results.fantasy5 = e.message; }),
    downloadFile(PDF_URL_CP,  PDF_PATH_CP).then(() => { results.cashpop  = 'ok'; }).catch(e => { results.cashpop  = e.message; }),
    downloadFile(PDF_URL_PB,  PDF_PATH_PB).then(() => { results.powerball = 'ok'; pbDrawsCache = null; }).catch(e => { results.powerball = e.message; }),
    downloadFile(PDF_URL_MM,  PDF_PATH_MM).then(() => { results.megamillions = 'ok'; mmDrawsCache = null; }).catch(e => { results.megamillions = e.message; }),
    ...Object.entries(PDF_URLS_PICK).map(([g, url]) =>
      downloadFile(url, PDF_PATHS_PICK[g]).then(() => { results[g] = 'ok'; pickCache[g] = null; }).catch(e => { results[g] = e.message; })
    ),
  ]);
  return results;
}

// ── Port helpers ──────────────────────────────────────────────────────────────

const PORT_START = 7000;
const PORT_END   = 7020;

function isPortInUse(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => { srv.close(); resolve(false); });
    srv.listen(port, '0.0.0.0');
  });
}

async function findFreePorts() {
  const used = [], free = [];
  for (let p = PORT_START; p <= PORT_END; p++) {
    if (await isPortInUse(p)) used.push(p); else free.push(p);
  }
  return { used, free };
}

function getPidOnPort(port) {
  return new Promise(resolve => {
    exec(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      for (const line of stdout.trim().split(/\r?\n/)) {
        if (!line.toUpperCase().includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) return resolve(pid);
      }
      resolve(null);
    });
  });
}

function killPid(pid) {
  return new Promise(resolve => exec(`taskkill /PID ${pid} /F`, () => resolve()));
}

function waitForPortFree(port, retries = 10, interval = 300) {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < retries; i++) {
      await new Promise(r => setTimeout(r, interval));
      if (!(await isPortInUse(port))) return resolve();
    }
    reject(new Error(`Port ${port} still in use after ${retries * interval}ms`));
  });
}

function openBrowser(url) { exec(`start "" "${url}"`); }

// ── Draw schedule ─────────────────────────────────────────────────────────────
// Drawings: every Tuesday & Friday at 11:15 PM ET
// Sales cutoff: 10:55 PM ET (20 min before draw)

function getNextDraw() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const DRAW_DAYS  = [2, 5]; // Tue=2, Fri=5
  const DRAW_H = 23, DRAW_M = 15;
  const CLOSE_H = 22, CLOSE_M = 55;

  const candidate = new Date(nowET);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < 8; i++) {
    if (DRAW_DAYS.includes(candidate.getDay())) {
      candidate.setHours(DRAW_H, DRAW_M, 0, 0);
      if (candidate > nowET) break;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }

  const salesClose = new Date(candidate);
  salesClose.setHours(CLOSE_H, CLOSE_M, 0, 0);

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return {
    dayName:     DAY_NAMES[candidate.getDay()],
    date:        `${MON_NAMES[candidate.getMonth()]} ${candidate.getDate()}, ${candidate.getFullYear()}`,
    drawTime:    '11:15 PM ET',
    closeTime:   '10:55 PM ET',
    salesOpen:   nowET < salesClose,
    msUntilDraw: candidate - nowET
  };
}

// ── PDF parsing ───────────────────────────────────────────────────────────────

function extractPDFText(pathOrBuffer) {
  return new Promise((resolve, reject) => {
    const p = new PDFParser(null, 1);
    const _warn = console.warn;
    console.warn = () => {};
    p.on('pdfParser_dataReady', () => { console.warn = _warn; resolve(p.getRawTextContent()); p.destroy(); });
    p.on('pdfParser_dataError', e => { console.warn = _warn; reject(new Error(e.parserError)); });
    if (typeof pathOrBuffer === 'string') p.loadPDF(pathOrBuffer);
    else p.parseBuffer(pathOrBuffer);
  });
}

// Returns array of { date, numbers, ts } sorted newest-first
function parseHistoryPDF(text) {
  const draws = [];
  const re = /(\d{2}\/\d{2}\/\d{2,4})\s+([\d\s\-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (nums && nums.length >= 6) {
      const numbers = nums.slice(0, 6).map(Number).filter(n => n >= 1 && n <= 46);
      if (numbers.length === 6) {
        const parts = date.split('/');
        let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
        const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
        draws.push({ date, numbers, ts });
      }
    }
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function parseFrequencyPDF(text) {
  const freq = {};
  const re = /\b(\d{1,2})\s+(\d{2,3})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseInt(m[1]), count = parseInt(m[2]);
    if (num >= 1 && num <= 46 && count > 0) freq[num] = count;
  }
  return freq;
}

let _freqCache = null;
let _freqParsePromise = null;
function getFreqText() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATHS.frequency).mtimeMs; } catch(e) { throw new Error('JTP frequency PDF not yet downloaded. Try again in a moment.'); }
  if (_freqCache && _freqCache.mtime === mtime) return Promise.resolve(_freqCache.text);
  if (!_freqParsePromise) {
    _freqParsePromise = extractPDFText(PDF_PATHS.frequency).then(text => {
      _freqCache = { text, mtime };
      _freqParsePromise = null;
      return text;
    });
  }
  return _freqParsePromise;
}

// ── Analysis ──────────────────────────────────────────────────────────────────

function scoreNumbers(nums, freq, draws, totalDraws) {
  const numArrays = draws.map(d => d.numbers);
  let score = 0;
  const maxFreq = Math.max(...Object.values(freq));

  nums.forEach(n => { score += (freq[n] || 0) / maxFreq * 40; });

  const recent = numArrays.slice(0, 50);
  nums.forEach(n => {
    const lastIdx = recent.map((d, i) => d.includes(n) ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });

  const pairCounts = {};
  numArrays.forEach(d => {
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) {
        const k = `${d[i]}-${d[j]}`;
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
  });
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const k = `${Math.min(nums[i], nums[j])}-${Math.max(nums[i], nums[j])}`;
      score += (pairCounts[k] || 0) / totalDraws * 15;
    }

  const low = nums.filter(n => n <= 23).length;
  score += (3 - Math.abs(low - 3)) * 5;

  const sorted = [...nums].sort((a, b) => a - b);
  score += Math.min((sorted[5] - sorted[0]) / 45, 1) * 10;

  return score;
}

function generateLines(freq, draws, count = 6, seenLines = new Set()) {
  const totalDraws = draws.length;
  const pool = Array.from({ length: 46 }, (_, i) => i + 1)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0))
    .slice(0, 30);

  // Scale candidate pool with requested count so quality stays high at large counts
  const candidateTarget = Math.max(5000, count * 100);
  const usedCombos = new Set();
  const candidates = [];

  for (let attempt = 0; attempt < candidateTarget; attempt++) {
    const candidate = [];
    const available = [...pool];
    while (candidate.length < 6) {
      const weights = available.map(n => (freq[n] || 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
      candidate.push(available[idx]);
      available.splice(idx, 1);
    }
    candidate.sort((a, b) => a - b);
    const key = candidate.join(',');
    if (!usedCombos.has(key)) {
      usedCombos.add(key);
      const penalty = seenLines.has(key) ? 30 : 0;
      candidates.push({ nums: candidate, score: scoreNumbers(candidate, freq, draws, totalDraws) - penalty });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.some(l => l.nums.filter(n => c.nums.includes(n)).length > 3)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

async function runAnalysis(count = 6, sid = null) {
  const draws = getJtpDraws();
  const freqText = await getFreqText();
  const freq  = parseFrequencyPDF(freqText);
  if (draws.length < 10) throw new Error(`Only ${draws.length} draws parsed from history PDF.`);
  if (Object.keys(freq).length < 20) throw new Error(`Only ${Object.keys(freq).length} numbers parsed from frequency PDF.`);

  const sess = sid ? getSession(sid) : { lines: new Set() };
  const lines = generateLines(freq, draws, count, sess.lines);
  lines.forEach(l => sess.lines.add(l.nums.join(',')));

  const freqStats = Object.entries(freq)
    .map(([n, c]) => ({ number: parseInt(n), count: c }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDraws:    draws.length,
    nextDraw:      getNextDraw(),
    recentHistory: draws.slice(0, 10),
    lines:         lines.map((l, i) => ({ line: i + 1, numbers: l.nums, score: Math.round(l.score * 10) / 10 })),
    topNumbers:    freqStats.slice(0, 10),
    bottomNumbers: freqStats.slice(-10).reverse(),
    lastUpdated:   fs.statSync(PDF_PATHS.history).mtime.toLocaleString()
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.get('/nextdraw', (req, res) => res.json(getNextDraw()));

app.get('/health', (req, res) => res.sendStatus(200));

app.get('/mode', (req, res) => {
  const isPublic = !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
  res.json({ local: !isPublic });
});

// ── Daily auto-refresh (first /analyze call of the day triggers a PDF download) ──────────────────
let lastAutoRefreshDate = null;
let autoRefreshPromise  = null;

function todayET() {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
}

async function ensureDailyRefresh() {
  const today = todayET();
  if (lastAutoRefreshDate === today) return;   // already refreshed today
  if (autoRefreshPromise) return autoRefreshPromise; // refresh in progress — wait for it
  autoRefreshPromise = downloadPDFs().then(() => {
    lastAutoRefreshDate = today;
    autoRefreshPromise  = null;
    console.log('Auto-refreshed PDFs for ' + today);
  }).catch(err => {
    autoRefreshPromise = null;
    console.warn('Auto-refresh failed: ' + err.message + ' (using cached PDFs)');
  });
  return autoRefreshPromise;
}

app.get('/analyze', async (req, res) => {
  try {
    await ensureDailyRefresh();
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    res.json(await runAnalysis(count, sid));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Serialized refresh queue ─────────────────────────────────────────────────
// All PDF downloads go through a single queue -- one at a time, no concurrent
// parses, no OOM from simultaneous 2.7MB Fantasy 5 + 1MB Lotto X loads.

const _refreshQueue = [];
let _refreshRunning = false;
const _refreshStatus = {}; // game -> { state: 'queued'|'running'|'done'|'error', ts, detail }

function enqueueRefresh(game, downloadFn, onDone) {
  _refreshStatus[game] = { state: 'queued', ts: Date.now() };
  _refreshQueue.push({ game, downloadFn, onDone });
  processRefreshQueue();
}

function processRefreshQueue() {
  if (_refreshRunning || !_refreshQueue.length) return;
  _refreshRunning = true;
  const { game, downloadFn, onDone } = _refreshQueue.shift();
  _refreshStatus[game] = { state: 'running', ts: Date.now() };
  console.log('Refresh queue: starting ' + game);
  downloadFn()
    .catch(err => {
      console.warn('Refresh queue: ' + game + ' failed, retrying in 30s: ' + err.message);
      _refreshStatus[game] = { state: 'retrying', ts: Date.now(), detail: err.message };
      return new Promise(resolve => setTimeout(resolve, 30000)).then(() => downloadFn());
    })
    .then(() => {
      _refreshStatus[game] = { state: 'done', ts: Date.now() };
      console.log('Refresh queue: done ' + game);
      if (onDone) onDone(null);
    })
    .catch(err => {
      _refreshStatus[game] = { state: 'error', ts: Date.now(), detail: err.message };
      console.warn('Refresh queue: ' + game + ' failed after retry: ' + err.message);
      if (onDone) onDone(err);
    })
    .finally(() => {
      _refreshRunning = false;
      processRefreshQueue();
    });
}

app.get('/refresh/status', (req, res) => res.json(_refreshStatus));

app.post('/refresh', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('jtp', () => downloadPDFs().then(dl => {
    const failed = Object.entries(dl).filter(([, v]) => v !== 'ok');
    if (failed.length) throw new Error('Download failed: ' + failed.map(([k,v]) => k+': '+v).join(', '));
    lastAutoRefreshDate = null;
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'jtp' });
});

app.post('/reset', (req, res) => { clearSession(req.body && req.body.sid ? req.body.sid : null); res.json({ ok: true }); });

// ── Shared chatbot math helpers ──────────────────────────────────────────────

function calcWinLoss(spent, won) {
  const net = won - spent;
  const roi = spent > 0 ? (net / spent * 100) : 0;
  const returnPct = spent > 0 ? (won / spent * 100) : 0;
  const wh = won > 5000 ? Math.round(won * 0.24) : 0;
  const netAfterTax = won - wh - spent;
  const lines = [
    'Spent:          $' + spent.toLocaleString(),
    'Won (gross):    $' + won.toLocaleString(),
    'Net profit/loss: ' + (net >= 0 ? '+$' : '-$') + Math.abs(net).toLocaleString(),
    'Return rate:    ' + returnPct.toFixed(1) + '% (got back ' + returnPct.toFixed(1) + '% of what you spent)',
    'ROI:            ' + (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%',
  ];
  if (wh > 0) {
    lines.push('');
    lines.push('After 24% federal withholding on winnings:');
    lines.push('  Withholding: -$' + wh.toLocaleString());
    lines.push('  Net after tax + spend: ' + (netAfterTax >= 0 ? '+$' : '-$') + Math.abs(netAfterTax).toLocaleString());
  }
  lines.push('');
  lines.push('Florida has no state income tax.');
  return lines.join('\n');
}

function tryWinLoss(q) {
  // "spent $20 won $500", "paid $10 and won $50", "I lost $30", "won $200 on $15 spend"
  const m = q.match(/(?:spent?|paid?|cost|spend|buy|bought|play(?:ed)?).{0,20}\$?(\d[\d,]*).{0,40}(?:won?|win|hit|got|prize|paid?|return).{0,20}\$?(\d[\d,]*)/i) ||
            q.match(/(?:won?|win|hit|got|prize).{0,20}\$?(\d[\d,]*).{0,40}(?:spent?|paid?|cost|spend|buy|bought|play(?:ed)?).{0,20}\$?(\d[\d,]*)/i);
  if (m) {
    const a = parseInt(m[1].replace(/,/g, '')), b = parseInt(m[2].replace(/,/g, ''));
    if (a > 0 && b >= 0 && a <= 1000000 && b <= 100000000) {
      // figure out which is spent vs won by context
      const firstIsSpend = /(?:spent?|paid?|cost|spend|buy|bought|play(?:ed)?)/.test(q.slice(0, q.search(/\$?(\d[\d,]*)/) + 10));
      const spent = firstIsSpend ? a : b;
      const won   = firstIsSpend ? b : a;
      return calcWinLoss(spent, won);
    }
  }
  // "lost $X" with no winnings
  const lostM = q.match(/(?:lost?|lose).{0,10}\$?(\d[\d,]*)/i);
  if (lostM) {
    const spent = parseInt(lostM[1].replace(/,/g, ''));
    if (spent > 0 && spent <= 1000000) return calcWinLoss(spent, 0);
  }
  return null;
}

function tryReturnPct(q) {
  // "what percent did I keep on $500 win $50 spend"
  const m = q.match(/(?:percent|pct|%|return|ratio|rate).{0,50}\$?(\d[\d,]*).{0,30}\$?(\d[\d,]*)/i);
  if (m) {
    const a = parseInt(m[1].replace(/,/g, '')), b = parseInt(m[2].replace(/,/g, ''));
    if (a > 0 && b > 0 && a <= 100000000 && b <= 100000000) {
      const spent = Math.min(a, b), won = Math.max(a, b);
      return calcWinLoss(spent, won);
    }
  }
  return null;
}

function tryContextualSpend(q, context) {
  if (!context || !context.spend) return null;
  // triggers on questions referencing generated lines/numbers without explicit dollar amounts
  if (!/(?:win|loss|ratio|roi|return|spent?|cost|paid?|profit|break.?even|how.?much.?(?:did|have)|my.?lines?|generated|above)/i.test(q)) return null;
  // skip if explicit dollar amounts already present (tryWinLoss will handle those)
  if (/\$\d|\d+\s*dollar/i.test(q)) return null;
  const spent = context.spend;
  // use context.won if provided (e.g. from Check My Numbers result), else try to parse from query
  const wonM = q.match(/(?:won?|win|hit|got|prize|return(?:ed)?).{0,15}(\d[\d,]*)/i);
  const won = (context.won != null && context.won >= 0) ? context.won : (wonM ? parseInt(wonM[1].replace(/,/g, '')) : 0);
  const label = context.game === 'cashpop'
    ? context.lines + ' number' + (context.lines !== 1 ? 's' : '') + ' at $' + Math.round(spent / context.lines) + ' each'
    : context.lines + ' ticket' + (context.lines !== 1 ? 's' : '');
  return 'Based on your ' + label + ' ($' + spent + ' spent):\n' + calcWinLoss(spent, won);
}

const TZ_RE = /time.?zone|what.?time.?zone|eastern.?time|\best\b|\bedt\b|\b(central|mountain|pacific).?time|convert.{0,20}time|time.{0,20}convert|what.?time.{0,20}(is|are|do|does|will)|my.?time|local.?time|utc|gmt|dst|daylight.?saving/i;
const TZ_REPLY = 'All draw times are shown in the local timezone of the state where the game is operated. For all current Florida Lottery games that means Eastern Time (ET).\n\nFlorida observes:\n- EST (UTC-5): early November through mid-March\n- EDT (UTC-4): mid-March through early November\n\nQuick conversions from ET:\n- Central (CT):  ET - 1 hour  (e.g. 11:15 PM ET = 10:15 PM CT)\n- Mountain (MT): ET - 2 hours (e.g. 11:15 PM ET = 9:15 PM MT)\n- Pacific (PT):  ET - 3 hours (e.g. 11:15 PM ET = 8:15 PM PT)\n\nThe app always shows the correct current Florida time regardless of where you are viewing it from. If we add games from other states in the future, each game will display times in that state\'s own local timezone, clearly labeled on the state row.';

const FL_APP_RE = /florida.?lottery.?app|lottery.?app|download.?app|mobile.?app|digital.?play.?slip|play.?slip|scan.?app|qr|iphone|android|app.?store|google.?play/i;
const FL_APP_REPLY = 'Yes! The Florida Lottery app lets you create and save your favorite numbers as digital play slips. Simply enter your generated numbers into the app, then have your retailer scan the digital slip to print your paper ticket -- it\'s that easy!\n\nTip: use the Email My Lines feature to send your numbers to yourself, then enter them into the app before heading to the store.\n\nDownload the Florida Lottery app:\n- App Store (iPhone): https://apps.apple.com/us/app/flalottery/id476160599?ls=1\n- Google Play (Android): https://play.google.com/store/apps/details?id=com.flalottery.FLALOTTERY';

function chatReply(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;

  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;

  const taxM = q.match(/(?:take.?home|after.?tax|net|lump.?sum|cash.?out|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|lump.?sum|keep)/i) ||
               q.match(/(?:tax|take.?home|net|keep).{0,20}(\d[\d,]+)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 10000000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      const net = raw - wh;
      const ann = raw > 250000 ? '\n- Annuity (25 yrs): ~$' + Math.round(raw / 25).toLocaleString() + '/yr before tax' : '';
      return 'Prize: $' + raw.toLocaleString() + ann +
        '\n- Federal withholding (24%): -$' + wh.toLocaleString() +
        '\n- Florida state tax: $0' +
        '\n- Estimated take-home: ~$' + net.toLocaleString() +
        '\n\nNote: Additional federal tax may be owed at filing (up to 37%). Consult a tax professional.';
    }
  }

  const matchM = q.match(/(?:if|when|what).{0,20}(?:win|match|hit|get).{0,20}(\d).{0,10}(?:of|out of).{0,5}6/i);
  if (matchM) {
    const m = parseInt(matchM[1]);
    if (m === 6) return 'Jackpot (6 of 6)! Prize starts at $250,000 (25-yr annuity) or cash lump sum.\n- Cash lump sum ~58-60% of annuity value\n- 24% federal withholding on prizes over $5,000\n- Florida: no state income tax\n- Must elect lump sum within 60 days';
    if (m === 5) return '5 of 6 on one line: ~$500\n- Under $5,000 - no automatic withholding\n- Estimated take-home: ~$500';
    if (m === 4) return '4 of 6 on one line: ~$25\n- No withholding. Take-home: ~$25';
    if (m === 3) return '3 of 6 on one line: ~$1\n- No withholding. Take-home: ~$1';
    return 'Matching ' + m + ' of 6: No prize';
  }

  const comboM = q.match(/combo.{0,30}(\d{1,2}).{0,10}(?:match|total|hit)/i) ||
                 q.match(/(\d{1,2}).{0,10}(?:total|combined).{0,20}match.{0,20}combo/i);
  if (comboM) {
    const n = parseInt(comboM[1]);
    const tiers = [[10,10000],[9,500],[8,50],[7,20],[6,10],[5,5],[4,'Free $2 ticket']];
    const t = tiers.find(function(x) { return n >= x[0]; });
    if (t) return n + ' total Combo matches - Prize: ' + (typeof t[1] === 'number' ? '$' + t[1].toLocaleString() : t[1]);
    return n + ' total Combo matches - No Combo prize (need 4+)';
  }

  if (/jackpot|prize|win|payout|pay out|how much|amount|worth/.test(q)) {
    if (/combo/.test(q))
      return 'The Combo add-on (+$1) pays fixed prizes based on total matches across all 3 lines:\n\n- 10+ matches: $10,000\n- 9 matches: $500\n- 8 matches: $50\n- 7 matches: $20\n- 6 matches: $10\n- 5 matches: $5\n- 4 matches: Free $2 Combo Quick Pick\n\nOverall Combo odds: 1 in 5.28. Combo prizes are NOT boosted during rolldowns.';
    if (/rolldown|roll down/.test(q))
      return 'When the jackpot pool reaches its cap and no one wins, a rolldown occurs - the excess flows down to boost the 5-of-6, 4-of-6, and 3-of-6 base game prizes. Combo prizes are fixed and not affected.';
    return 'Jackpot Triple Play prizes per line (pari-mutuel - vary by number of winners):\n\n- 6 of 6: Jackpot ($250,000+ starting, 25-yr annuity)\n- 5 of 6: ~$500 (odds: 1 in 13,009)\n- 4 of 6: ~$25 (odds: 1 in 267)\n- 3 of 6: ~$1 (odds: 1 in 16.14)\n\nOverall odds: 1 in 15.24.\n\nTip: ask "take-home on $500" or "what do I win for 5 of 6" for exact math.';
  }

  if (/odd|chance|probabilit|likel/.test(q))
    return 'Florida Jackpot odds:\n\nBase game (per line):\n- 6 of 6: 1 in 3,122,273\n- 5 of 6: 1 in 13,009\n- 4 of 6: 1 in 267\n- 3 of 6: 1 in 16.14\n- Any base prize: 1 in 15.24\n\nCombo add-on (all 3 lines combined):\n- 10+ matches: 1 in 323,322\n- Any Combo prize: 1 in 5.28';

  if (/tax|lump|cash|take.?home|annuit|after|net|irs|federal/.test(q))
    return 'Tax & payout details:\n\n- Jackpot: 25-year annuity; elect cash lump sum within 60 days (~58-60%)\n- Prizes over $5,000: 24% federal withholding\n- Florida: NO state income tax\n- Top federal bracket 37% - may owe more at filing\n\nEstimated take-home examples:\n- $500 prize: ~$500 (under threshold)\n- $250,000 jackpot (cash): ~$114,000 after 24% withholding\n- $3,000,000 jackpot (cash): ~$1.37M after 24% withholding\n\nTip: ask "take-home on $[amount]" for any specific prize.';

  if (/combo/.test(q))
    return 'The Combo add-on costs +$1 (ticket = $2 total). It combines matches across all 3 lines for a fixed prize.\n\nCombo prizes:\n- 10+ matches: $10,000\n- 9: $500 | 8: $50 | 7: $20 | 6: $10 | 5: $5\n- 4 matches: Free $2 Combo Quick Pick\n\nOverall odds: 1 in 5.28. You win BOTH base game AND Combo prizes on the same ticket.\n\nTip: ask "combo prize for 7 matches" to calculate a specific tier.';

  if (/cost|price|how much|ticket.{0,10}cost|cost.{0,10}ticket|how much.{0,10}play|spend|cheap/.test(q))
    return 'Jackpot Triple Play ticket costs (estimated, subject to change):\n\n- Base ticket: $1 per ticket (you pick 1 line; 2 more auto Quick Pick lines included)\n- With Combo add-on: $2 per ticket\n\nExamples:\n- 1 ticket: $1 base / $2 with Combo\n- 3 tickets: $3 base / $6 with Combo\n- 6 tickets: $6 base / $12 with Combo\n\nPrices are based on the known Florida Lottery price structure and are subject to change. Always confirm at your retailer.';

  if (/how.{0,10}play|rules|work|ticket|price/.test(q))
    return 'How to play Jackpot Triple Play:\n\n- Cost: $1 per ticket (or $2 with Combo)\n- Each ticket has 3 lines of 6 numbers from 1-46\n- You choose 1 line per ticket -- the other 2 are always auto Quick Pick\n- Each line scored separately for base game prizes\n- Drawings: Tuesday & Friday at 11:15 PM ET\n- Sales close at 10:55 PM ET\n- Tickets can be canceled within 2 hours of purchase (not after 10:55 PM)';

  if (/when|draw|schedul|time|day|tuesday|friday/.test(q))
    return 'Florida Jackpot drawing schedule:\n\n- Draw days: Every Tuesday and Friday\n- Draw time: 11:15 PM Eastern Time\n- Ticket sales cutoff: 10:55 PM ET\n- Tickets purchased after 10:55 PM go into the next drawing';

  if (/rolldown|roll.?down/.test(q))
    return 'The Rolldown: When the jackpot pool reaches its cap and no ticket matches all 6 numbers, the excess rolls down to boost 5-of-6, 4-of-6, and 3-of-6 prizes. Combo prizes are fixed and NOT boosted.';

  if (/cancel|void/.test(q))
    return 'Ticket cancellation:\n\n- Cancel within 2 hours of purchase\n- Cannot cancel after 10:55 PM ET for that drawing\n- Combo tickets CANNOT be canceled at any time\n- Must cancel at the same retailer that sold the ticket';

  if (/claim|deadline|expir|collect|redeem/.test(q))
    return 'Prize claim details:\n\n- Claim within 180 days of the drawing date\n- Elect lump sum within 60 days - otherwise defaults to 25 annual payments\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters';

  if (/advance|multiple.?draw|future.?draw/.test(q))
    return 'Advance Play: play up to 30 consecutive drawings in advance. Not available with the $5 or $10 Quick Picks box.';

  if (/\b(texas|california|new york|ohio|georgia|michigan|illinois|pennsylvania|new jersey|arizona|colorado|virginia|north carolina|massachusetts|washington|oregon|nevada|maryland|connecticut|minnesota|wisconsin|missouri|louisiana|kentucky|tennessee|indiana|alabama|south carolina|oklahoma|arkansas|iowa|mississippi|kansas|utah|nebraska|west virginia|idaho|hawaii|maine|new hampshire|rhode island|montana|delaware|south dakota|north dakota|alaska|vermont|wyoming|new mexico)\b/i.test(q))
    return 'Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Every donation helps us expand to new states -- visit jackpot.allaml.ai to donate and help make it happen!';
  return 'I can answer questions about Jackpot Triple Play payouts, odds, taxes, Combo, rolldowns, and draw schedule - and do the math for you.\n\nTry asking:\n- "What do I win for 5 of 6?"\n- "Take-home on $500"\n- "Combo prize for 8 matches"\n- "Spent $10 won $25 -- what is my ROI?"\n- "When is the next drawing?"\n\nNote: Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Donate at jackpot.allaml.ai and help us expand!';
}

app.post('/check', (req, res) => {
  const { drawn, lines } = req.body;
  // drawn: array of 6 numbers, lines: array of 3 arrays of 6 numbers each
  if (!Array.isArray(drawn) || drawn.length !== 6 ||
      !Array.isArray(lines) || lines.length !== 3 ||
      !lines.every(l => Array.isArray(l) && l.length === 6)) {
    return res.status(400).json({ error: 'Provide drawn (6 numbers) and lines (3 x 6 numbers).' });
  }

  const drawnSet = new Set(drawn.map(Number));

  // Base game payouts per line (pari-mutuel estimates)
  // Jackpot is a shared pari-mutuel pool — multiple winning lines split it,
  // they do NOT each receive the full amount. 5-of-6 and below are independent per-line prizes.
  const BASE_PRIZES  = { 5: 500, 4: 25, 3: 1, 2: 0, 1: 0, 0: 0 };
  const JACKPOT_POOL = 250000; // starting pool (actual varies)

  // Combo fixed prizes by total matches across all 3 lines
  const COMBO_PRIZES = { 10: 10000, 9: 500, 8: 50, 7: 20, 6: 10, 5: 5, 4: 'FREE' };

  // Score each line — flag jackpot lines separately
  const lineResults = lines.map((line, i) => {
    const nums    = line.map(Number);
    const matched = nums.filter(n => drawnSet.has(n));
    const count   = matched.length;
    const isJackpot = count === 6;
    const prize   = isJackpot ? 'JACKPOT' : (BASE_PRIZES[count] || 0);
    return { line: i + 1, numbers: nums, matched, count, prize, isJackpot };
  });

  // You collect 100% of the jackpot pool regardless of how many of YOUR lines win —
  // because you own all the winning shares on your ticket.
  // The pool only gets split if OTHER players' tickets also have winning lines.
  // Each of your winning lines shows the full pool value; the note explains the real-world caveat.
  const jackpotLines = lineResults.filter(l => l.isJackpot).length;
  const jackpotShare = JACKPOT_POOL; // full pool — you own all winning shares on your ticket
  lineResults.forEach(l => { if (l.isJackpot) l.prize = jackpotShare; });

  // Combo: count every matching spot across all 18 numbers (duplicates count separately)
  let comboTotal = 0;
  lines.forEach(line => {
    line.map(Number).forEach(n => { if (drawnSet.has(n)) comboTotal++; });
  });

  // Find combo prize (highest tier at or below comboTotal)
  let comboPrize = 0;
  let comboTier  = null;
  for (const [tier, prize] of Object.entries(COMBO_PRIZES).sort((a,b) => parseInt(b[0])-parseInt(a[0]))) {
    if (comboTotal >= parseInt(tier)) { comboPrize = prize; comboTier = parseInt(tier); break; }
  }

  const basePrizeTotal = lineResults.reduce((sum, l) => sum + (typeof l.prize === 'number' ? l.prize : 0), 0);
  const comboWin = typeof comboPrize === 'number' ? comboPrize : 0;

  res.json({
    drawn:          drawn.map(Number),
    lineResults,
    jackpotLines,
    jackpotShare,
    comboTotal,
    comboTier,
    comboPrize,
    basePrizeTotal,
    totalWin:       basePrizeTotal + comboWin
  });
});


// ── Email ─────────────────────────────────────────────────────────────────────────────

const EMAIL_CFG_PATH = path.join(__dirname, 'email.config.json');

function getEmailConfig() {
  if (fs.existsSync(EMAIL_CFG_PATH)) {
    try { return JSON.parse(fs.readFileSync(EMAIL_CFG_PATH, 'utf8')); }
    catch (e) {}
  }
  if (process.env.EMAIL_API_KEY) {
    return {
      provider: 'resend',
      apiKey: process.env.EMAIL_API_KEY,
      from: process.env.EMAIL_FROM || 'Jackpot Analyzer <noreply@allaml.ai>'
    };
  }
  return null;
}

async function sendViaResend(cfg, to, subject, text, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: cfg.from, to: Array.isArray(to) ? to : [to], subject, text, html });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error('Resend ' + res.statusCode + ': ' + d)));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// Get current email config (API key masked)
app.get('/email/config', (req, res) => {
  const cfg = getEmailConfig();
  if (!cfg || !cfg.apiKey || cfg.apiKey === 'PASTE_YOUR_RESEND_API_KEY_HERE') return res.json({ configured: false });
  res.json({
    configured: true,
    from: cfg.from || '',
    keyMasked: cfg.apiKey.slice(0, 8) + '...'
  });
});

// Save email config
app.post('/email/config', (req, res) => {
  const { apiKey, from } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required.' });
  const cfg = {
    provider: 'resend',
    apiKey,
    from: from || 'Florida Jackpot Analyzer <noreply@allaml.ai>'
  };
  fs.writeFileSync(EMAIL_CFG_PATH, JSON.stringify(cfg, null, 2));
  res.json({ ok: true });
});

// Test email config
app.post('/email/test', async (req, res) => {
  const cfg = getEmailConfig();
  if (!cfg || !cfg.apiKey) return res.status(503).json({ error: 'Email not configured yet.' });
  try {
    await sendViaResend(cfg, cfg.from.match(/<(.+)>/)?.[1] || cfg.from, 'Jackpot Analyzer — Email Test', 'Your email configuration is working correctly.');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/email', async (req, res) => {
  const { to, lines, nextDraw, winningNumbers, winDrawDate, winDrawType, winPrize } = req.body;
  if (!to || !lines || !Array.isArray(lines)) return res.status(400).json({ error: 'Missing required fields.' });
  if (!lines.length && !winningNumbers) return res.status(400).json({ error: 'Select at least one option to include.' });

  const cfg = getEmailConfig();
  if (!cfg || !cfg.apiKey || cfg.apiKey === 'PASTE_YOUR_RESEND_API_KEY_HERE')
    return res.status(503).json({ error: 'Email not configured. Add your Resend API key in the Email Settings card.' });

  const recipients = to.split(',').map(e => e.trim()).filter(e => e.includes('@'));
  if (!recipients.length) return res.status(400).json({ error: 'No valid email addresses provided.' });

  const drawLabel = nextDraw ? nextDraw.dayName + ' ' + nextDraw.date : 'Next Drawing';
  const { game } = req.body;
  const gameLabel = game === 'lottox' ? 'Florida Lotto (Lotto X)' : game === 'fantasy5' ? 'Fantasy 5' : 'Jackpot Triple Play';
  const subject = gameLabel + ' — ' + drawLabel + ' Best Odds Lines';

  const lineText = lines.length ? lines.map((l, i) =>
    (i === 0 ? 'BEST LINE: ' : 'Line ' + l.line + ':    ') + l.numbers.join('  -  ') + '   (score: ' + l.score + ')'
  ).join('\n') : '';

  const winMeta = [];
  if (winDrawDate) { const p = winDrawDate.split('-'); winMeta.push(p[1] + '/' + p[2] + '/' + p[0]); }
  if (winDrawType) winMeta.push(winDrawType.charAt(0) + winDrawType.slice(1).toLowerCase());
  if (winPrize != null && winPrize > 0) winMeta.push('Prize: $' + winPrize.toLocaleString());
  else if (winPrize === 0) winMeta.push('No prize');
  const winText = winningNumbers && winningNumbers.length ? 'Winning Numbers: ' + winningNumbers.join('  -  ') + (winMeta.length ? '  (' + winMeta.join(' - ') + ')' : '') : '';

  const year = new Date().getFullYear();
  const textParts = [
    'Florida Jackpot Analyzer',
    'Drawing: ' + drawLabel + ' at 11:15 PM ET',
    'Sales close: 10:55 PM ET', ''
  ];
  if (lineText) { textParts.push('Your Best Odds Lines', '='.repeat(40), lineText, '', '='.repeat(40)); }
  if (winText)  { textParts.push(winText, ''); }
  const text = [
    ...textParts,
    'Generated by jackpot.allaml.ai  |  Powered by AllaML (allaml.ai)',
    '',
    'Did you know? Download the Florida Lottery app to create digital play slips from your generated numbers -- just have the cashier scan the app to print your ticket!',
    'App Store: https://apps.apple.com/us/app/flalottery/id476160599?ls=1',
    'Google Play: https://play.google.com/store/apps/details?id=com.flalottery.FLALOTTERY',
    '',
    'For entertainment only. Lottery outcomes are random. No statistical system can guarantee lottery winnings. Please play responsibly.',
    'This tool is not affiliated with or endorsed by the Florida Lottery.',
    '\u00a9 ' + year + ' AllaML. All rights reserved.',
  ].join('\n');

  const winMetaHtml = winMeta.length ? '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + winMeta.join(' &middot; ') + '</div>' : '';
  const winRow = winningNumbers && winningNumbers.length
    ? '<tr style="border-bottom:1px solid #2a2d3a;"><td style="padding:10px 12px;font-size:12px;color:#22c55e;font-weight:700;white-space:nowrap;min-width:60px;">&#127942; Winning</td><td style="padding:10px 12px;">' +
      winningNumbers.map(n => '<span style="display:inline-block;width:38px;height:38px;line-height:38px;text-align:center;border-radius:50%;background:#22c55e;color:#fff;font-weight:700;font-size:14px;margin:3px;">' + n + '</span>').join('&nbsp;') +
      winMetaHtml + '</td></tr>'
    : '';

  const lineRows = lines.map((l, i) => {
    const balls = l.numbers.map(n =>
      '<span style="display:inline-block;width:38px;height:38px;line-height:38px;text-align:center;border-radius:50%;background:' +
      (i === 0 ? '#f59e0b' : '#4f8ef7') + ';color:#fff;font-weight:700;font-size:14px;margin:3px;">' + n + '</span>'
    ).join('&nbsp;');
    return '<tr style="border-bottom:1px solid #2a2d3a;"><td style="padding:10px 12px;font-size:12px;color:' +
      (i === 0 ? '#f59e0b' : '#64748b') + ';font-weight:700;white-space:nowrap;min-width:60px;">' +
      (i === 0 ? '&#11088; Best' : 'Line ' + l.line) +
      '</td><td style="padding:10px 12px;">' + balls + '</td></tr>';
  }).join('');

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:540px;margin:0 auto;background:#0f1117;color:#e2e8f0;border-radius:12px;overflow:hidden;border:1px solid #2a2d3a;">' +
    '<div style="background:#1a1d27;padding:20px 24px;border-bottom:1px solid #2a2d3a;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700;">' + (game === 'lottox' ? '&#127808;' : game === 'fantasy5' ? '&#127775;' : '&#127921;') + ' ' + gameLabel + '</h1>' +
    '<p style="margin:6px 0 0;color:#64748b;font-size:13px;">Next Drawing: <strong style="color:#e2e8f0;">' + drawLabel + ' at 11:15 PM ET</strong> &nbsp;&middot;&nbsp; Sales close 10:55 PM ET</p>' +
    '</div>' +
    '<div style="padding:20px 24px;">' +
    '<p style="margin:0 0 14px;font-size:13px;color:#64748b;">Your statistically optimized lines based on complete official Florida Lottery draw history:</p>' +
    '<table style="border-collapse:collapse;width:100%;background:#1a1d27;border-radius:8px;overflow:hidden;border:1px solid #2a2d3a;">' +
    '<thead><tr style="background:#0f1117;"><th style="text-align:left;padding:8px 12px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Line</th>' +
    '<th style="text-align:left;padding:8px 12px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Numbers</th></tr></thead>' +
    '<tbody>' + winRow + lineRows + '</tbody></table>' +
    '</div>' +
    '<div style="padding:16px 24px;background:#1a1d27;border-top:1px solid #2a2d3a;">' +
    '<p style="margin:0 0 8px;font-size:12px;color:#64748b;text-align:center;">' +
    'Generated by <a href="https://jackpot.allaml.ai" style="color:#4f8ef7;text-decoration:none;">jackpot.allaml.ai</a> &nbsp;&middot;&nbsp; Powered by <a href="https://allaml.ai" style="color:#4f8ef7;text-decoration:none;">AllaML</a>' +
    '</p>' +
    '<p style="margin:0 0 10px;font-size:12px;color:#e2e8f0;text-align:center;line-height:1.7;">' +
    '&#128241; <strong>Did you know?</strong> Download the Florida Lottery app to create digital play slips from your generated numbers &mdash; just have the cashier scan the app to print your ticket!<br>' +
    '<a href="https://apps.apple.com/us/app/flalottery/id476160599?ls=1" style="color:#4f8ef7;text-decoration:none;margin-right:12px;" target="_blank">&#128241; App Store</a>' +
    '<a href="https://play.google.com/store/apps/details?id=com.flalottery.FLALOTTERY" style="color:#4f8ef7;text-decoration:none;" target="_blank">&#129514; Google Play</a>' +
    '</p>' +
    '<p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">' +
    'For entertainment only. Lottery outcomes are random. No statistical system can guarantee lottery winnings. Please play responsibly.<br>' +
    'This tool is not affiliated with or endorsed by the Florida Lottery. &nbsp;&copy; ' + new Date().getFullYear() + ' AllaML. All rights reserved.' +
    '</p>' +
    '</div></div>';

  try {
    await sendViaResend(cfg, recipients, subject, text, html);
    res.json({ ok: true, sent: recipients.length });
  } catch (err) {
    res.status(500).json({ error: 'Send failed: ' + err.message });
  }
});

app.post('/chat', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReply(message, context) });
});

// ── Lotto X ───────────────────────────────────────────────────────────────────

function getNextDrawLottoX() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DRAW_DAYS = [3, 6];
  const DRAW_H = 23, DRAW_M = 15, CLOSE_H = 22, CLOSE_M = 55;
  const candidate = new Date(nowET);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 8; i++) {
    if (DRAW_DAYS.includes(candidate.getDay())) {
      candidate.setHours(DRAW_H, DRAW_M, 0, 0);
      if (candidate > nowET) break;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  const salesClose = new Date(candidate);
  salesClose.setHours(CLOSE_H, CLOSE_M, 0, 0);
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    dayName: DAY_NAMES[candidate.getDay()],
    date: `${MON_NAMES[candidate.getMonth()]} ${candidate.getDate()}, ${candidate.getFullYear()}`,
    drawTime: '11:15 PM ET', closeTime: '10:55 PM ET',
    salesOpen: nowET < salesClose, msUntilDraw: candidate - nowET
  };
}

function parseLottoXHistoryPDF(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+LOTTO(?!\s+DP)\s+\d/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (nums && nums.length >= 6) {
      const numbers = nums.slice(0, 6).map(Number).filter(n => n >= 1 && n <= 53);
      if (numbers.length === 6) {
        const parts = date.split('/');
        let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
        const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
        draws.push({ date, numbers, ts });
      }
    }
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function scoreLottoX(nums, freq, draws, totalDraws) {
  const numArrays = draws.map(d => d.numbers);
  let score = 0;
  const maxFreq = Math.max(...Object.values(freq));
  nums.forEach(n => { score += (freq[n] || 0) / maxFreq * 40; });
  const recent = numArrays.slice(0, 50);
  nums.forEach(n => {
    const lastIdx = recent.map((d, i) => d.includes(n) ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });
  const pairCounts = {};
  numArrays.forEach(d => {
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) {
        const k = `${d[i]}-${d[j]}`;
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
  });
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const k = `${Math.min(nums[i], nums[j])}-${Math.max(nums[i], nums[j])}`;
      score += (pairCounts[k] || 0) / totalDraws * 15;
    }
  const low = nums.filter(n => n <= 26).length;
  score += (3 - Math.abs(low - 3)) * 5;
  const sorted = [...nums].sort((a, b) => a - b);
  score += Math.min((sorted[5] - sorted[0]) / 52, 1) * 10;
  return score;
}

function generateLottoXLines(freq, draws, count = 6, seenLines = new Set()) {
  const totalDraws = draws.length;
  const pool = Array.from({ length: 53 }, (_, i) => i + 1)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0)).slice(0, 35);
  const candidateTarget = Math.max(5000, count * 100);
  const usedCombos = new Set();
  const candidates = [];
  for (let attempt = 0; attempt < candidateTarget; attempt++) {
    const candidate = [];
    const available = [...pool];
    while (candidate.length < 6) {
      const weights = available.map(n => (freq[n] || 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
      candidate.push(available[idx]);
      available.splice(idx, 1);
    }
    candidate.sort((a, b) => a - b);
    const key = candidate.join(',');
    if (!usedCombos.has(key)) {
      usedCombos.add(key);
      const penalty = seenLines.has(key) ? 30 : 0;
      candidates.push({ nums: candidate, score: scoreLottoX(candidate, freq, draws, totalDraws) - penalty });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.some(l => l.nums.filter(n => c.nums.includes(n)).length > 3)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

// JSON draw cache -- replaces PDF text cache for large PDFs
// Reads from committed JSON file (instant), appends deltas after each refresh
const JSON_PATH_LX = path.join(__dirname, 'lottox_draws.json');
let lxDrawsCache = null;
let lxLastPdfMtime = null;

function getLottoXDraws() {
  if (lxDrawsCache) return lxDrawsCache;
  try {
    lxDrawsCache = JSON.parse(fs.readFileSync(JSON_PATH_LX, 'utf8'));
    return lxDrawsCache;
  } catch(e) { throw new Error('Lotto X draw cache not found. Run generate_draw_cache.js locally.'); }
}

async function appendLottoXDeltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_LX).mtimeMs; } catch(e) { return; }
  if (mtime === lxLastPdfMtime) { console.log('Lotto X: PDF unchanged, skipping parse.'); return; }
  const existing = getLottoXDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
  let text;
  try { text = await extractPDFText(PDF_PATH_LX); } catch(e) { return; }
  lxLastPdfMtime = mtime;
  const all = parseLottoXHistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('Lotto X: no new draws in PDF.'); return; }
  const merged = newDraws.concat(existing).slice(0, 500);
  lxDrawsCache = merged;
  fs.writeFileSync(JSON_PATH_LX, JSON.stringify(merged, null, 2));
  console.log('Lotto X: appended ' + newDraws.length + ' new draw(s). Total: ' + merged.length);
}

async function runAnalysisLottoX(count = 6, sid = null) {
  const draws = getLottoXDraws();
  if (draws.length < 10) throw new Error(`Only ${draws.length} Lotto X draws in cache.`);
  const freq = {};
  draws.forEach(d => d.numbers.forEach(n => { freq[n] = (freq[n] || 0) + 1; }));
  const sess = sid ? getSession(sid) : { lines: new Set() };
  const lines = generateLottoXLines(freq, draws, count, sess.lines);
  lines.forEach(l => sess.lines.add(l.nums.join(',')));
  const freqStats = Object.entries(freq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  return {
    totalDraws: draws.length, nextDraw: getNextDrawLottoX(),
    recentHistory: draws.slice(0, 10),
    lines: lines.map((l, i) => ({ line: i + 1, numbers: l.nums, score: Math.round(l.score * 10) / 10 })),
    topNumbers: freqStats.slice(0, 10), bottomNumbers: freqStats.slice(-10).reverse(),
    lastUpdated: draws[0] ? draws[0].date : 'unknown'
  };
}

function chatReplyLottoX(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;

  const taxM = q.match(/(?:take.?home|after.?tax|net|lump.?sum|cash.?out|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|lump.?sum|keep)/i) ||
               q.match(/(?:tax|take.?home|net|keep).{0,20}(\d[\d,]+)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 100000000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      const net = raw - wh;
      const ann = raw > 1000000 ? '\n- Annuity (25 yrs): ~$' + Math.round(raw / 25).toLocaleString() + '/yr before tax' : '';
      return 'Prize: $' + raw.toLocaleString() + ann +
        '\n- Federal withholding (24%): -$' + wh.toLocaleString() +
        '\n- Florida state tax: $0' +
        '\n- Estimated take-home: ~$' + net.toLocaleString() +
        '\n\nNote: Additional federal tax may be owed at filing (up to 37%). Consult a tax professional.';
    }
  }

  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;

  const multM = q.match(/(\d).{0,15}(?:of|out of).{0,5}6.{0,30}(\d{1,2}).{0,5}x/i) ||
                q.match(/(\d{1,2}).{0,5}x.{0,30}(\d).{0,15}(?:of|out of).{0,5}6/i);
  if (multM) {
    const a = parseInt(multM[1]), b = parseInt(multM[2]);
    const matches = a <= 6 ? a : b;
    const multRaw = a <= 6 ? b : a;
    const VALID = [2, 3, 4, 5, 10];
    const mult = VALID.includes(multRaw) ? multRaw : 1;
    const BASE = { 6: 'JACKPOT', 5: 3000, 4: 50, 3: 5, 2: 'FREE', 1: 0, 0: 0 };
    const raw = BASE[matches];
    if (raw === 'JACKPOT') return 'Jackpot! 6 of 6 - not multiplied. Claim within 60 days for lump sum.';
    if (raw === 'FREE') return '2 of 6 - Free Ticket (not multiplied).';
    if (raw > 0) {
      const prize = raw * mult;
      const wh = prize > 5000 ? Math.round(prize * 0.24) : 0;
      const net = prize - wh;
      return matches + ' of 6 with ' + mult + 'x multiplier:\n- Base prize: $' + raw.toLocaleString() + ' x ' + mult + ' = $' + prize.toLocaleString() +
        (wh > 0 ? '\n- Federal withholding (24%): -$' + wh.toLocaleString() : '\n- Under $5,000 - no automatic withholding') +
        '\n- Estimated take-home: ~$' + net.toLocaleString();
    }
    return matches + ' of 6 - No prize.';
  }

  const simpleM = q.match(/(?:win|prize|payout|get|worth).{0,20}(\d).{0,10}(?:of|out of).{0,5}6/i) ||
                  q.match(/(\d).{0,10}(?:of|out of).{0,5}6.{0,20}(?:win|prize|payout|worth)/i);
  if (simpleM) {
    const m = parseInt(simpleM[1]);
    const B = { 6: 'Jackpot (pari-mutuel)', 5: '$3,000 x multiplier (e.g. $6,000-$30,000)', 4: '$50 x multiplier (e.g. $100-$500)', 3: '$5 x multiplier (e.g. $10-$50)', 2: 'Free Ticket', 1: 'No prize', 0: 'No prize' };
    const D = { 6: '$250,000 fixed', 5: '$3,500 x mult', 4: '$60 x mult', 3: '$7 x mult', 2: 'Free Ticket', 1: 'No prize', 0: 'No prize' };
    if (m >= 0 && m <= 6) return m + ' of 6 - Base: ' + (B[m] || 'No prize') + '\nDouble Play (if you have it): ' + (D[m] || 'No prize') + '\n\nTip: ask "' + m + ' of 6 with 5x" for exact math.';
  }

  const ezM = q.match(/ezmatch.{0,30}\$(\d[\d,]*)/i) || q.match(/\$(\d[\d,]*).{0,30}ezmatch/i);
  if (ezM) {
    const ez = parseInt(ezM[1].replace(/,/g, ''));
    if (ez >= 1 && ez <= 500) return 'EZMatch prize: $' + ez.toLocaleString() + '\n- Instant win - no drawing needed\n- No federal withholding (under $5,000)\n- Take-home: ~$' + ez.toLocaleString() + '\n\nEZMatch is paid in addition to any base game or Double Play prizes.';
  }

  if (/jackpot|prize|win|payout|how much|worth/.test(q)) {
    if (/double.?play/.test(q))
      return 'Double Play (+$1) prizes (fixed):\n\n- 6 of 6: $250,000 (not multiplied)\n- 5 of 6: $3,500 x multiplier (up to $35,000 with 10x)\n- 4 of 6: $60 x multiplier (up to $600 with 10x)\n- 3 of 6: $7 x multiplier (up to $70 with 10x)\n- 2 of 6: Free Ticket\n\nOverall Double Play odds: 1 in 7.61\nTip: ask "4 of 6 with 10x" to calculate the exact prize.';
    if (/ezmatch|ez.?match/.test(q))
      return 'EZMatch (+$1) instant-win prizes: $500 | $250 | $100 | $50 | $20 | $15 | $10 | $5 | $4 | $3 | $2\n\nOverall EZMatch odds: 1 in 4.71\nInstant win - no drawing required. Claim within 180 days.';
    if (/multiplier|multiply/.test(q))
      return 'Multiplier prize table (base x multiplier):\n\n5 of 6: $3,000 x 2=6K | x3=9K | x4=12K | x5=15K | x10=30K\n4 of 6: $50 x 2=100 | x3=150 | x4=200 | x5=250 | x10=500\n3 of 6: $5 x 2=10 | x3=15 | x4=20 | x5=25 | x10=50\n\nJackpot and Free Ticket are NOT multiplied.\nTip: ask "5 of 6 with 10x" for a full take-home breakdown.';
    return 'Florida Lotto (Lotto X) prizes:\n\n- 6 of 6: Jackpot (pari-mutuel, rolls until won)\n- 5 of 6: $3,000 x multiplier (up to $30,000 with 10x)\n- 4 of 6: $50 x multiplier (up to $500 with 10x)\n- 3 of 6: $5 x multiplier (up to $50 with 10x)\n- 2 of 6: Free Ticket (not multiplied)\n\nDouble Play (same numbers, separate draw):\n- 6 of 6: $250,000 fixed | 5 of 6: $3,500 x mult | 4 of 6: $60 x mult | 3 of 6: $7 x mult\n\nTip: ask "5 of 6 with 5x" for exact math.';
  }

  if (/odd|chance|probabilit/.test(q))
    return 'Florida Lotto odds (per ticket):\n\n- 6 of 6 (jackpot): 1 in 22,957,480\n- 5 of 6: 1 in 81,409\n- 4 of 6: 1 in 1,415\n- 3 of 6: 1 in 70.79\n- 2 of 6: 1 in 8.58 (free ticket)\n- Any prize: 1 in 7.61\n\nDouble Play odds: 1 in 7.61 | EZMatch odds: 1 in 4.71';

  if (/multiplier|multiply/.test(q))
    return 'Every Florida Lotto ticket gets a random multiplier (2x, 3x, 4x, 5x, or 10x) at purchase.\n\nIt multiplies the 2nd, 3rd, and 4th prizes. Jackpot and Free Ticket are NOT multiplied.\n\nMultiplier odds: 10x is 1 in 26 | 5x is 1 in 8.67 | 4x is 1 in 5.20 | 3x is 1 in 3.25 | 2x is 1 in 2.89\n\nTip: ask "5 of 6 with 10x" to calculate the exact prize and take-home.';

  if (/ezmatch|ez.?match/.test(q))
    return 'EZMatch (+$1): 6 instant-win numbers printed on your ticket at purchase. If any match your 6 Lotto numbers, you win instantly.\n\nPrizes: $2 to $500 | Overall odds: 1 in 4.71\nSeparate from base game and Double Play. Claim within 180 days.\n\nTip: ask "ezmatch $50" to see the take-home on a specific EZMatch prize.';

  if (/double.?play/.test(q))
    return 'Double Play (+$1): A bonus drawing held right after the main Lotto draw, using your same 6 numbers and multiplier.\n\nTop prize: $250,000 fixed (not multiplied). All other prizes use your multiplier.\nOverall odds: 1 in 7.61. Prizes combined with base game winnings into one payment.\n\nTip: ask "4 of 6 with 5x" to calculate the exact prize.';

  if (/tax|lump|cash|take.?home|annuit|after|net/.test(q))
    return 'Tax & payout details:\n\n- Jackpot: 25-year annuity or cash lump sum (~58-60%); elect within 60 days\n- Prizes over $5,000: 24% federal withholding\n- Florida: NO state income tax\n- Top federal bracket 37% - may owe more at filing\n\nEstimated take-home examples:\n- $3,000 (5-of-6, no mult): ~$3,000 (under threshold)\n- $30,000 (5-of-6, 10x): ~$22,800 after 24% withholding\n- $250,000 (DP top prize): ~$190,000 after 24% withholding\n\nTip: ask "take-home on $30000" for any specific amount.';

  if (/cost|price|how much|ticket.{0,10}cost|cost.{0,10}ticket|how much.{0,10}play|spend|cheap/.test(q))
    return 'Florida Lotto (Lotto X) ticket costs (estimated, subject to change):\n\n- Base ticket: $2 per ticket (1 line)\n- EZMatch add-on: +$1 per ticket\n- Double Play add-on: +$1 per ticket\n- Both add-ons: +$2 per ticket ($4 total)\n\nExamples:\n- 1 ticket, base only: $2\n- 1 ticket + EZMatch: $3\n- 1 ticket + Double Play: $3\n- 1 ticket + both: $4\n- 6 tickets, base only: $12\n- 6 tickets + both add-ons: $24\n\nPrices are based on the known Florida Lottery price structure and are subject to change. Always confirm at your retailer.';

  if (/how.{0,10}play|rules|work|ticket|price/.test(q))
    return 'How to play Florida Lotto (Lotto X):\n\n- Cost: $2 per ticket (1 line of 6 numbers from 1-53)\n- Every ticket includes a random multiplier (2x/3x/4x/5x/10x) for non-jackpot prizes\n- Match 2 of 6: free ticket | Match 3+: cash prizes x multiplier\n- Add-ons: EZMatch (+$1, instant win up to $500) | Double Play (+$1, bonus draw up to $250K)\n- Drawings: Wednesday & Saturday at 11:15 PM ET | Sales close 10:55 PM ET';
  if (/when|draw|schedul|time|day|wednesday|saturday/.test(q))
    return 'Florida Lotto drawing schedule:\n\n- Draw days: Every Wednesday and Saturday\n- Draw time: 11:15 PM Eastern Time\n- Ticket sales cutoff: 10:55 PM ET\n- Double Play drawing held immediately after the main drawing';

  if (/claim|deadline|expir|collect/.test(q))
    return 'Prize claim details:\n\n- Prizes expire 180 days from the drawing date\n- Lump sum must be elected within 60 days\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters\n- EZMatch prizes: claim within 180 days of the first draw date on the ticket';

  if (/advance|multiple.?draw|future.?draw/.test(q))
    return 'Advance Play: play up to 52 consecutive drawings in advance. Not available with Jackpot Combo. EZMatch applies to the first play only on advance tickets.';

  if (/jackpot.?combo|combo.?jackpot/.test(q))
    return 'Jackpot Combo ($9): a bundle of 3 Quick Pick tickets - one Florida Lotto ($2), one Powerball ($2), and one Mega Millions ($5) - all for the next available drawing. EZMatch cannot be added to Jackpot Combo tickets. Not available with Advance Play.';

  if (/\b(texas|california|new york|ohio|georgia|michigan|illinois|pennsylvania|new jersey|arizona|colorado|virginia|north carolina|massachusetts|washington|oregon|nevada|maryland|connecticut|minnesota|wisconsin|missouri|louisiana|kentucky|tennessee|indiana|alabama|south carolina|oklahoma|arkansas|iowa|mississippi|kansas|utah|nebraska|west virginia|idaho|hawaii|maine|new hampshire|rhode island|montana|delaware|south dakota|north dakota|alaska|vermont|wyoming|new mexico)\b/i.test(q))
    return 'Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Every donation helps us expand to new states -- visit jackpot.allaml.ai to donate and help make it happen!';
  return 'I can answer questions about Florida Lotto (Lotto X) payouts, odds, multipliers, EZMatch, Double Play, taxes, and draw schedule - and do the math for you.\n\nTry asking:\n- "What do I win for 5 of 6?"\n- "5 of 6 with 10x" (exact prize + take-home)\n- "Take-home on $30,000"\n- "Spent $20 won $150 -- what is my ROI?"\n- "When is the next drawing?"\n\nNote: Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Donate at jackpot.allaml.ai and help us expand!';
}

app.get('/nextdraw/lottox', (req, res) => res.json(getNextDrawLottoX()));

let lastAutoRefreshLottoX = null;
let autoRefreshLottoXPromise = null;

async function ensureDailyRefreshLottoX() {
  const today = todayET();
  if (lastAutoRefreshLottoX === today) return;
  if (autoRefreshLottoXPromise) return autoRefreshLottoXPromise;
  autoRefreshLottoXPromise = downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => {
    lastAutoRefreshLottoX = today;
    autoRefreshLottoXPromise = null;
    console.log('Auto-refreshed Lotto X PDF for ' + today);
  }).catch(err => {
    autoRefreshLottoXPromise = null;
    console.warn('Lotto X auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshLottoXPromise;
}

app.get('/analyze/lottox', async (req, res) => {
  try {
    await ensureDailyRefreshLottoX();
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    res.json(await runAnalysisLottoX(count, sid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/refresh/lottox', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => {
    lastAutoRefreshLottoX = null; return appendLottoXDeltas();
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'lottox' });
});

app.post('/check/lottox', (req, res) => {
  const { drawn, line, multiplier, doublePlayDrawn, ezMatch } = req.body;
  if (!Array.isArray(drawn) || drawn.length !== 6 || !Array.isArray(line) || line.length !== 6)
    return res.status(400).json({ error: 'Provide drawn (6 numbers) and line (6 numbers).' });
  const VALID_MULT = [2, 3, 4, 5, 10];
  const mult = VALID_MULT.includes(parseInt(multiplier)) ? parseInt(multiplier) : 1;
  const ezMatchWin = Math.min(Math.max(parseInt(ezMatch) || 0, 0), 500);
  const drawnSet = new Set(drawn.map(Number));
  const nums = line.map(Number);
  const matched = nums.filter(n => drawnSet.has(n));
  const count = matched.length;
  const BASE = { 6: 'JACKPOT', 5: 3000, 4: 50, 3: 5, 2: 'FREE', 1: 0, 0: 0 };
  const raw = BASE[count];
  let prize = 0, prizeDisplay, multiplied = false;
  if (raw === 'JACKPOT')   { prizeDisplay = 'JACKPOT'; }
  else if (raw === 'FREE') { prizeDisplay = 'Free Ticket'; }
  else if (raw > 0)        { prize = raw * mult; prizeDisplay = '$' + prize.toLocaleString(); multiplied = mult > 1; }
  else                     { prizeDisplay = 'No prize'; }
  let dpPrize = 0, dpDisplay = null, dpMatched = [], dpCount = 0;
  if (Array.isArray(doublePlayDrawn) && doublePlayDrawn.length === 6) {
    const dpSet = new Set(doublePlayDrawn.map(Number));
    dpMatched = nums.filter(n => dpSet.has(n));
    dpCount = dpMatched.length;
    const DP = { 6: 250000, 5: 3500, 4: 60, 3: 7, 2: 'FREE', 1: 0, 0: 0 };
    const dpRaw = DP[dpCount];
    if (dpRaw === 250000)    { dpDisplay = '$250,000 (Top Prize)'; dpPrize = 250000; }
    else if (dpRaw === 'FREE') { dpDisplay = 'Free Ticket (DP)'; }
    else if (dpRaw > 0)      { dpPrize = dpRaw * mult; dpDisplay = '$' + dpPrize.toLocaleString() + (mult > 1 ? ' (' + mult + 'x)' : ''); }
    else                     { dpDisplay = 'No DP prize'; }
  }
  const totalWin = prize + dpPrize + ezMatchWin;
  res.json({
    drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, multiplied, multiplier: mult,
    doublePlay: { drawn: doublePlayDrawn ? doublePlayDrawn.map(Number) : null, matched: dpMatched, count: dpCount, prize: dpPrize, display: dpDisplay },
    ezMatch: ezMatchWin, totalWin, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE'
  });
});

app.post('/chat/lottox', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyLottoX(message, context) });
});



async function start() {
  let port;

  if (process.env.PORT) {
    port = parseInt(process.env.PORT);
  } else {
    const { used, free } = await findFreePorts();
    if (used.length > 0) {
      port = used[0];
      const pid = await getPidOnPort(port);
      if (pid) {
        console.log(`Killing existing session (PID ${pid}) on port ${port}...`);
        await killPid(pid);
      }
      process.stdout.write('Waiting for port to be released...');
      try { await waitForPortFree(port); console.log(' done.'); }
      catch (e) {
        console.log('\n  Still busy, using next free port.');
        port = free[0];
        if (!port) { console.error('No free ports available. Exiting.'); process.exit(1); }
      }
    } else {
      port = PORT_START;
    }
  }

  const server = http.createServer(app);
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE'
      ? `\n❌ Port ${port} still in use. Try again or choose [N].`
      : 'Server error: ' + err.message);
    process.exit(1);
  });

  server.listen(port, '0.0.0.0', () => {
    const localUrl = `http://localhost:${port}`;
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   🎱  Florida Jackpot Analyzer                      ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║   Local:      ${localUrl.padEnd(38)}║`);
    console.log('║   Public:     https://jackpot.allaml.ai              ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Press Ctrl+C to stop.\n');
    openBrowser(localUrl);
    // JSON draw caches (LX + F5) are read from committed JSON files -- instant, no PDF parse
    // appendXxxDeltas() only runs after scheduled/manual refresh when PDF has new draws
    process.stdout.write('Loading draw caches and downloading PDFs...');
    // Hard timeout: mark server ready after 90s regardless
    setTimeout(() => { if (!_serverReady) { _serverReady = true; console.log('Server ready (startup timeout).'); } }, 90000);
    try { getLottoXDraws(); getFantasy5Draws(); getPbDraws(); getMmDraws(); console.log(' done.'); } catch(e) { console.log(' warning: ' + e.message); }
    // Download PDFs, warm JTP+CP caches, then run delta detection
    try { getJtpDraws(); getCpDraws(); console.log('JTP+CP JSON caches loaded.'); } catch(e) { console.log('Warning: ' + e.message); }
    _serverReady = true;
    console.log('Server ready.');
    // Pick games now use JSON caches (getPickDraws) -- no PDF warming needed
    downloadPDFs()
      .then(() => appendJtpDeltas()).catch(() => {})
      .then(() => appendCpDeltas()).catch(() => {})
      .then(() => appendLottoXDeltas())
      .then(() => appendFantasy5Deltas()).catch(() => {})
      .then(() => appendPbDeltas()).catch(() => {})
      .then(() => appendMmDeltas()).catch(() => {});
    // Jackpot cache warms naturally when users look up draw dates (scrapeFlDraws side effect)
  });
}

// ── Cash Pop ─────────────────────────────────────────────────────────────────

const CP_DRAW_TIMES = [
  { name: 'Morning',    hour: 7,  min: 29 },
  { name: 'Matinee',    hour: 11, min: 29 },
  { name: 'Afternoon',  hour: 14, min: 29 },
  { name: 'Evening',    hour: 18, min: 29 },
  { name: 'Late Night', hour: 22, min: 29 }
];

function getNextDrawCashPop() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let offset = 0; offset < 2; offset++) {
    const day = new Date(nowET);
    day.setDate(day.getDate() + offset);
    for (const d of CP_DRAW_TIMES) {
      const candidate = new Date(day);
      candidate.setHours(d.hour, d.min, 0, 0);
      if (candidate > nowET) {
        const salesClose = new Date(candidate);
        salesClose.setMinutes(salesClose.getMinutes() - 5);
        const fmtTime = h => {
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
          return h12 + ':' + String(d.min).padStart(2,'0') + ' ' + ampm + ' ET';
        };
        return {
          drawName: d.name,
          dayName: DAY_NAMES[candidate.getDay()],
          date: MON_NAMES[candidate.getMonth()] + ' ' + candidate.getDate() + ', ' + candidate.getFullYear(),
          drawTime: fmtTime(d.hour),
          closeTime: (salesClose.getHours() > 12 ? salesClose.getHours() - 12 : (salesClose.getHours() === 0 ? 12 : salesClose.getHours())) + ':' + String(salesClose.getMinutes()).padStart(2,'0') + (salesClose.getHours() >= 12 ? ' PM' : ' AM') + ' ET',
          salesOpen: nowET < salesClose,
          msUntilDraw: candidate - nowET
        };
      }
    }
  }
}

function parseCashPopHistoryPDF(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].split('/');
    const ts = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    const numbers = [1,2,3,4,5].map(i => parseInt(m[i + 1])).filter(n => n >= 1 && n <= 15);
    if (numbers.length === 5) draws.push({ date: m[1], numbers, ts });
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function scoreCashPop(n, freq, draws, totalDraws) {
  const maxFreq = Math.max(...Object.values(freq));
  let score = (freq[n] || 0) / maxFreq * 40;
  const recent = draws.slice(0, 50);
  const lastIdx = recent.map((d, i) => d.numbers.includes(n) ? i : -1).filter(i => i >= 0).pop();
  if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  return score;
}

async function runAnalysisCashPop(count = 5, sid = null) {
  const draws = getCpDraws();
  if (draws.length < 5) throw new Error('Only ' + draws.length + ' Cash Pop draws parsed.');
  const freq = {};
  draws.forEach(d => d.numbers.forEach(n => { freq[n] = (freq[n] || 0) + 1; }));
  const sess = sid ? getSession(sid) : { lines: new Set() };
  const numbers = Array.from({ length: 15 }, (_, i) => i + 1)
    .map(n => ({ n, score: scoreCashPop(n, freq, draws, draws.length) - (sess.lines.has(String(n)) ? 30 : 0) + Math.random() * 5 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(count, 15))
    .map(x => x.n)
    .sort((a, b) => a - b);
  numbers.forEach(n => sess.lines.add(String(n)));
  const freqStats = Object.entries(freq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  return {
    totalDraws: draws.length,
    nextDraw: getNextDrawCashPop(),
    recentHistory: draws.slice(0, 10),
    numbers,
    topNumbers: freqStats.slice(0, 5),
    bottomNumbers: freqStats.slice(-5).reverse(),
    lastUpdated: fs.statSync(PDF_PATH_CP).mtime.toLocaleString()
  };
}

let lastAutoRefreshCP = null;
let autoRefreshCPPromise = null;

async function ensureDailyRefreshCP() {
  const today = todayET();
  if (lastAutoRefreshCP === today) return;
  if (autoRefreshCPPromise) return autoRefreshCPPromise;
  autoRefreshCPPromise = downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => {
    lastAutoRefreshCP = today;
    autoRefreshCPPromise = null;
    console.log('Auto-refreshed Cash Pop PDF for ' + today);
  }).catch(err => {
    autoRefreshCPPromise = null;
    console.warn('Cash Pop auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshCPPromise;
}

app.get('/nextdraw/cashpop', (req, res) => res.json(getNextDrawCashPop()));

app.get('/analyze/cashpop', async (req, res) => {
  try {
    await ensureDailyRefreshCP();
    const count = Math.min(Math.max(parseInt(req.query.count) || 5, 1), 15);
    const sid = req.query.sid || null;
    res.json(await runAnalysisCashPop(count, sid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/refresh/cashpop', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => {
    lastAutoRefreshCP = null;
    cpDrawsCache = null;
  }).then(() => appendCpDeltas()).catch(() => {}));
  clearSession(sid);
  res.json({ queued: true, game: 'cashpop' });
});

app.post('/check/cashpop', (req, res) => {
  const { winningNumber, yourNumber, playAmount, prizeMultiplier } = req.body;
  const wn = parseInt(winningNumber);
  const yn = parseInt(yourNumber);
  const pa = parseInt(playAmount);
  const pm = parseInt(prizeMultiplier);
  if (isNaN(wn) || wn < 1 || wn > 15) return res.status(400).json({ error: 'Winning number must be 1-15.' });
  if (isNaN(yn) || yn < 1 || yn > 15) return res.status(400).json({ error: 'Your number must be 1-15.' });
  if (![1,2,5,10].includes(pa)) return res.status(400).json({ error: 'Play amount must be 1, 2, 5, or 10.' });
  if (isNaN(pm) || pm < 5 || pm > 250) return res.status(400).json({ error: 'Prize multiplier must be 5-250.' });
  const matched = wn === yn;
  const prize = matched ? pa * pm : 0;
  const wh = prize > 5000 ? Math.round(prize * 0.24) : 0;
  res.json({ winningNumber: wn, yourNumber: yn, matched, playAmount: pa, prizeMultiplier: pm, prize, withholding: wh, takeHome: prize - wh });
});

function chatReplyCashPop(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;

  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;

  // Specific prize calc: "$5 with 100x" or "100x with $5"
  const prizeM = q.match(/(\d+).{0,10}x.{0,30}\$(\d+)/i) || q.match(/\$(\d+).{0,30}(\d+).{0,10}x/i);
  if (prizeM) {
    const a = parseInt(prizeM[1]), b = parseInt(prizeM[2]);
    const mult = a >= 5 && a <= 250 ? a : b;
    const amt = [1,2,5,10].includes(b) ? b : ([1,2,5,10].includes(a) ? a : null);
    if (amt && mult >= 5 && mult <= 250) {
      const prize = amt * mult;
      const wh = prize > 5000 ? Math.round(prize * 0.24) : 0;
      return 'Nice! $' + amt + ' x ' + mult + 'x = $' + prize.toLocaleString() + '.' +
        (wh > 0 ? ' After 24% federal withholding ($' + wh.toLocaleString() + '), you take home ~$' + (prize - wh).toLocaleString() + '. Florida has no state income tax.' :
        ' No federal withholding on that amount, so you keep the full $' + prize.toLocaleString() + '. Florida has no state income tax.');
    }
  }

  // Take-home on a specific dollar amount
  const taxM = q.match(/(?:take.?home|after.?tax|net|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|keep)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 100000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      if (wh > 0) return 'On a $' + raw.toLocaleString() + ' prize, 24% federal withholding takes out $' + wh.toLocaleString() + '. Florida has no state tax, so you take home ~$' + (raw - wh).toLocaleString() + '.';
      return 'A $' + raw.toLocaleString() + ' prize is under the $5,000 withholding threshold, so no automatic deductions -- you keep the full $' + raw.toLocaleString() + '. Florida has no state income tax.';
    }
  }

  // "played $10 and hit" -- no multiplier known yet
  const hitM = q.match(/(?:played?|play|bet|spent?).{0,10}\$?(1|2|5|10)(?:\b).{0,30}(?:hit|won?|match|win|caught?|got)/i) ||
               q.match(/(?:hit|won?|match|win|caught?|got).{0,30}(?:played?|play|bet|spent?).{0,10}\$?(1|2|5|10)(?:\b)/i) ||
               q.match(/\$?(1|2|5|10).{0,20}(?:hit|won?|match|win|caught?|got).{0,20}(?:number|it|one)/i);
  if (hitM) {
    const amt = parseInt(hitM[1]);
    if ([1,2,5,10].includes(amt)) {
      const min = amt * 5, max = amt * 250;
      return 'Congrats! Your prize is $' + amt + ' x whatever multiplier is printed on your ticket. That puts you anywhere from $' + min.toLocaleString() + ' (5x) up to $' + max.toLocaleString() + ' (250x) -- all under the tax withholding threshold so you keep every dollar.\n\nCheck your ticket for the multiplier and ask me "$' + amt + ' with [multiplier]x" for the exact number.';
    }
  }

  // Generic win/prize question without specifics
  if (/prize|win|pay|worth|much|amount/.test(q))
    return 'Your prize is simply your play amount times the multiplier printed on your ticket. So a $5 play with a 100x multiplier wins you $500, a $10 play with 250x wins $2,500, and so on.\n\nMultipliers range from 5x to 250x and are randomly assigned at purchase -- you see it on the ticket before the draw. All Cash Pop prizes are under the $5,000 tax withholding threshold, so you keep the full amount.\n\nTell me your play amount and multiplier and I can give you the exact figure.';

  if (/odd|chance|probabilit/.test(q))
    return 'Each number you play has a 1 in 15 chance of winning since there are 15 possible numbers and one is drawn. Play more numbers and your odds improve proportionally -- 5 numbers gives you a 1 in 3 shot, 10 numbers is 2 in 3, and if you play all 15 you are guaranteed to match.\n\nThe tradeoff is cost: more numbers means more spend, though each number wins independently at its full prize.';

  if (/cost|price|how much|ticket.{0,10}cost|cost.{0,10}ticket|how much.{0,10}play|spend|cheap/.test(q))
    return 'You pick a play amount -- $1, $2, $5, or $10 -- and that applies to every number you select. So if you pick 5 numbers at $5 each, you are spending $25 total. Pick 3 numbers at $2 each and it is $6.\n\nHigher play amounts mean bigger prizes since your prize is play amount x multiplier. Prices are based on the known Florida Lottery structure and subject to change -- always confirm at the retailer.';

  if (/how.{0,10}play|rules|work/.test(q))
    return 'Cash Pop is pretty simple. Pick 1 to 15 numbers from 1-15 and choose how much to play per number ($1, $2, $5, or $10). The terminal randomly assigns a prize multiplier (5x to 250x) and prints it on your ticket -- so you already know your potential prize before the draw.\n\nOne winning number is drawn. If it matches any of yours, you win that play amount times your multiplier. There are 5 draws every day, and you can play multiple draws in advance.';

  if (/when|draw|schedul|time|day|morning|midday|matinee|afternoon|evening|night/.test(q))
    return 'Cash Pop runs 5 times a day, every day:\n\n- Morning:    7:29 AM ET\n- Matinee:    11:29 AM ET\n- Afternoon:  2:29 PM ET\n- Evening:    6:29 PM ET\n- Late Night: 10:29 PM ET\n\nSales close about 5 minutes before each draw, so make sure you buy in time.';

  if (/tax|take.?home|after|net|withhold/.test(q))
    return 'Good news -- all Cash Pop prizes at standard play amounts are under the $5,000 federal withholding threshold, so nothing is automatically deducted. The max prize is $10 x 250x = $2,500, which you keep in full. Florida also has no state income tax.\n\nIf you somehow had a prize over $5,000, 24% would be withheld federally. Ask me "take-home on $[amount]" if you want the math on a specific prize.';

  if (/claim|expir|collect|redeem/.test(q))
    return 'Prizes up to $599 can be claimed at any Florida Lottery retailer. Anything $600 or more needs to go through a Florida Lottery district office. Either way, you have 180 days from the draw date before the prize expires.';

  if (/multiplier|multiply|5x|250x/.test(q))
    return 'The multiplier is randomly assigned by the terminal when you buy your ticket -- it prints right on it, so you know your potential prize before the draw even happens. It ranges from 5x to 250x your play amount.\n\nHigher multipliers are rarer but the Florida Lottery does not publish the exact odds for each tier. Ask me "$5 with 100x" (or any combo) and I will calculate the exact prize and take-home for you.';

  if (/\b(texas|california|new york|ohio|georgia|michigan|illinois|pennsylvania|new jersey|arizona|colorado|virginia|north carolina|massachusetts|washington|oregon|nevada|maryland|connecticut|minnesota|wisconsin|missouri|louisiana|kentucky|tennessee|indiana|alabama|south carolina|oklahoma|arkansas|iowa|mississippi|kansas|utah|nebraska|west virginia|idaho|hawaii|maine|new hampshire|rhode island|montana|delaware|south dakota|north dakota|alaska|vermont|wyoming|new mexico)\b/i.test(q))
    return 'Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Every donation helps us expand to new states -- visit jackpot.allaml.ai to donate and help make it happen!';
  return 'I can help with Cash Pop prizes, odds, draw times, taxes, and more. Try asking something like:\n\n- "How do I play?"\n- "What are my odds if I play 5 numbers?"\n- "$10 with 200x" -- I will calculate the exact prize\n- "Spent $50 won $250 -- what is my return?"\n- "When is the next draw?"\n\nNote: Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Donate at jackpot.allaml.ai and help us expand!';
}

app.post('/chat/cashpop', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyCashPop(message, context) });
});

// ── Fantasy 5 ─────────────────────────────────────────────────────────────────

function getNextDrawFantasy5() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const draws = [
    { name: 'Midday',  hour: 13, min: 5,  closeH: 12, closeM: 45 },
    { name: 'Evening', hour: 23, min: 15, closeH: 22, closeM: 55 }
  ];
  for (let offset = 0; offset < 2; offset++) {
    const day = new Date(nowET);
    day.setDate(day.getDate() + offset);
    for (const d of draws) {
      const candidate = new Date(day);
      candidate.setHours(d.hour, d.min, 0, 0);
      if (candidate > nowET) {
        const salesClose = new Date(candidate);
        salesClose.setHours(d.closeH, d.closeM, 0, 0);
        const fmt = (h, m) => {
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
          return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm + ' ET';
        };
        return {
          drawName: d.name,
          dayName: DAY_NAMES[candidate.getDay()],
          date: MON_NAMES[candidate.getMonth()] + ' ' + candidate.getDate() + ', ' + candidate.getFullYear(),
          drawTime: fmt(d.hour, d.min),
          closeTime: fmt(d.closeH, d.closeM),
          salesOpen: nowET < salesClose,
          msUntilDraw: candidate - nowET
        };
      }
    }
  }
}

function parseFantasy5HistoryPDF(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(MIDDAY|EVENING)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const drawType = m[2].toUpperCase();
    const numbers = [3,4,5,6,7].map(i => parseInt(m[i])).filter(n => n >= 1 && n <= 36);
    if (numbers.length === 5) {
      const parts = date.split('/');
      let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
      const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
      draws.push({ date, drawType, numbers, ts });
    }
  }
  draws.sort((a, b) => b.ts - a.ts || (a.drawType === 'EVENING' ? -1 : 1));
  return draws.slice(0, 500);
}

function scoreFantasy5(nums, freq, draws, totalDraws) {
  const numArrays = draws.map(d => d.numbers);
  let score = 0;
  const maxFreq = Math.max(...Object.values(freq));
  nums.forEach(n => { score += (freq[n] || 0) / maxFreq * 40; });
  const recent = numArrays.slice(0, 50);
  nums.forEach(n => {
    const lastIdx = recent.map((d, i) => d.includes(n) ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });
  const pairCounts = {};
  numArrays.forEach(d => {
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) {
        const k = `${d[i]}-${d[j]}`;
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
  });
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const k = `${Math.min(nums[i], nums[j])}-${Math.max(nums[i], nums[j])}`;
      score += (pairCounts[k] || 0) / totalDraws * 15;
    }
  const low = nums.filter(n => n <= 18).length;
  score += (2 - Math.abs(low - 2)) * 5;
  const sorted = [...nums].sort((a, b) => a - b);
  score += Math.min((sorted[4] - sorted[0]) / 35, 1) * 10;
  return score;
}

function generateFantasy5Lines(freq, draws, count = 6, seenLines = new Set()) {
  const totalDraws = draws.length;
  const pool = Array.from({ length: 36 }, (_, i) => i + 1)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0)).slice(0, 28);
  const candidateTarget = Math.max(5000, count * 100);
  const usedCombos = new Set();
  const candidates = [];
  for (let attempt = 0; attempt < candidateTarget; attempt++) {
    const candidate = [];
    const available = [...pool];
    while (candidate.length < 5) {
      const weights = available.map(n => (freq[n] || 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
      candidate.push(available[idx]);
      available.splice(idx, 1);
    }
    candidate.sort((a, b) => a - b);
    const key = candidate.join(',');
    if (!usedCombos.has(key)) {
      usedCombos.add(key);
      const penalty = seenLines.has(key) ? 30 : 0;
      candidates.push({ nums: candidate, score: scoreFantasy5(candidate, freq, draws, totalDraws) - penalty });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.some(l => l.nums.filter(n => c.nums.includes(n)).length > 3)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

const JSON_PATH_F5 = path.join(__dirname, 'fantasy5_draws.json');
let f5DrawsCache = null;
let f5LastPdfMtime = null;

function getFantasy5Draws() {
  if (f5DrawsCache) return f5DrawsCache;
  try {
    f5DrawsCache = JSON.parse(fs.readFileSync(JSON_PATH_F5, 'utf8'));
    return f5DrawsCache;
  } catch(e) { throw new Error('Fantasy 5 draw cache not found. Run generate_draw_cache.js locally.'); }
}

async function appendFantasy5Deltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_F5).mtimeMs; } catch(e) { return; }
  if (mtime === f5LastPdfMtime) { console.log('Fantasy 5: PDF unchanged, skipping parse.'); return; }
  const existing = getFantasy5Draws();
  const newestTs = existing.length ? existing[0].ts : 0;
  let text;
  try { text = await extractPDFText(PDF_PATH_F5); } catch(e) { return; }
  f5LastPdfMtime = mtime;
  const all = parseFantasy5HistoryPDF(text).filter(d => d.ts <= Date.now() && d.ts > new Date('2000-01-01').getTime());
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('Fantasy 5: no new draws in PDF.'); return; }
  const merged = newDraws.concat(existing).slice(0, 500);
  f5DrawsCache = merged;
  fs.writeFileSync(JSON_PATH_F5, JSON.stringify(merged, null, 2));
  console.log('Fantasy 5: appended ' + newDraws.length + ' new draw(s). Total: ' + merged.length);
}

async function runAnalysisFantasy5(count = 6, sid = null) {
  const draws = getFantasy5Draws();
  if (draws.length < 10) throw new Error('Only ' + draws.length + ' Fantasy 5 draws in cache.');
  const freq = {};
  draws.forEach(d => d.numbers.forEach(n => { freq[n] = (freq[n] || 0) + 1; }));
  const sess = sid ? getSession(sid) : { lines: new Set() };
  const lines = generateFantasy5Lines(freq, draws, count, sess.lines);
  lines.forEach(l => sess.lines.add(l.nums.join(',')));
  const freqStats = Object.entries(freq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  return {
    totalDraws: draws.length,
    nextDraw: getNextDrawFantasy5(),
    recentHistory: draws.slice(0, 10),
    lines: lines.map((l, i) => ({ line: i + 1, numbers: l.nums, score: Math.round(l.score * 10) / 10 })),
    topNumbers: freqStats.slice(0, 10),
    bottomNumbers: freqStats.slice(-10).reverse(),
    lastUpdated: draws[0] ? draws[0].date : 'unknown'
  };
}

function chatReplyFantasy5(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;

  const taxM = q.match(/(?:take.?home|after.?tax|net|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|keep)/i) ||
               q.match(/(?:tax|take.?home|net|keep).{0,20}(\d[\d,]+)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 10000000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      const net = raw - wh;
      return 'Prize: $' + raw.toLocaleString() +
        '\n- Federal withholding (24%): -$' + wh.toLocaleString() +
        '\n- Florida state tax: $0' +
        '\n- Estimated take-home: ~$' + net.toLocaleString() +
        '\n\nNote: Additional federal tax may be owed at filing (up to 37%). Consult a tax professional.';
    }
  }

  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;

  const matchM = q.match(/(\d).{0,10}(?:of|out of).{0,5}5/i);
  if (matchM) {
    const m = parseInt(matchM[1]);
    const prizes = { 5: 'Jackpot (pari-mutuel, starts ~$200,000)', 4: '~$500', 3: '~$10', 2: 'Free Quick Pick ticket', 1: 'No prize', 0: 'No prize' };
    if (m >= 0 && m <= 5) return m + ' of 5 - Prize: ' + (prizes[m] || 'No prize') + '\n\nAll prizes except the jackpot are pari-mutuel and vary by number of winners. Tip: ask "take-home on $500" for exact math.';
  }

  if (/jackpot|prize|win|payout|how much|worth/.test(q))
    return 'Fantasy 5 prizes (pari-mutuel - vary by number of winners):\n\n- 5 of 5: Jackpot (~$200,000 starting, rolls until won)\n- 4 of 5: ~$500\n- 3 of 5: ~$10\n- 2 of 5: Free Quick Pick ticket\n\nOverall odds: 1 in 8.39\n\nTip: ask "take-home on $500" or "what do I win for 4 of 5" for exact math.';

  if (/odd|chance|probabilit/.test(q))
    return 'Fantasy 5 odds (per ticket):\n\n- 5 of 5 (jackpot): 1 in 376,992\n- 4 of 5: 1 in 2,432\n- 3 of 5: 1 in 81.07\n- 2 of 5: 1 in 8.39 (free ticket)\n- Any prize: 1 in 7.61';

  if (/cost|price|how much|ticket.{0,10}cost|how much.{0,10}play|spend/.test(q))
    return 'Fantasy 5 ticket costs (estimated, subject to change):\n\n- Base ticket: $1 per play (1 line of 5 numbers)\n- EZMatch add-on: +$1 per ticket\n\nExamples:\n- 1 ticket: $1 base / $2 with EZMatch\n- 6 tickets: $6 base / $12 with EZMatch\n\nPrices are based on the known Florida Lottery price structure and are subject to change. Always confirm at your retailer.';

  if (/ezmatch|ez.?match/.test(q))
    return 'EZMatch (+$1): instant-win numbers printed on your ticket at purchase. If any match your 5 Fantasy 5 numbers, you win instantly - no drawing required.\n\nPrizes: $2 to $500 | Overall odds: 1 in 4.71\nClaim within 180 days of the first draw date on the ticket.';

  if (/how.{0,10}play|rules|work|ticket/.test(q))
    return 'How to play Fantasy 5:\n\n- Cost: $1 per play (1 line of 5 numbers from 1-36)\n- Mark MID for midday, EVE for evening, or BOTH for both draws\n- Advance Play: up to 30 consecutive days (60 drawings if both draws)\n- Add EZMatch (+$1) for instant-win prizes up to $500\n- Tickets can be canceled within 2 hours of purchase (not after sales cutoff; EZMatch tickets cannot be canceled)';

  if (/when|draw|schedul|time|day|midday|evening|mid|eve/.test(q))
    return 'Fantasy 5 drawing schedule:\n\n- Midday draw: 1:05 PM ET every day\n- Evening draw: 11:15 PM ET every day\n- Midday sales close: ~12:45 PM ET\n- Evening sales close: 10:55 PM ET\n\nDrawings are held 7 days a week.';

  if (/cancel|void/.test(q))
    return 'Ticket cancellation:\n\n- Cancel within 2 hours of purchase\n- Cannot cancel after the sales cutoff for that drawing\n- EZMatch tickets CANNOT be canceled\n- Free Quick Pick prize tickets cannot be canceled\n- Must cancel at the same retailer that sold the ticket';

  if (/claim|deadline|expir|collect|redeem/.test(q))
    return 'Prize claim details:\n\n- Claim within 180 days of the drawing date\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters\n- EZMatch prizes: claim within 180 days of the first draw date on the ticket';

  if (/advance|multiple.?draw|future.?draw/.test(q))
    return 'Advance Play: play the same numbers for up to 30 consecutive days (up to 60 drawings if selecting both Midday and Evening). If you claim a win before all scheduled drawings occur, the terminal prints a free continuation ticket for the remaining draws.';

  if (/tax|take.?home|after|net|withhold/.test(q))
    return 'Tax details:\n\n- Prizes over $5,000: 24% federal withholding\n- Florida: NO state income tax\n- Top federal bracket 37% - may owe more at filing\n\nEstimated take-home examples:\n- $10 prize: ~$10 (under threshold)\n- $500 prize: ~$500 (under threshold)\n- $200,000 jackpot: ~$152,000 after 24% withholding\n\nTip: ask "take-home on $[amount]" for any specific prize.';

  if (/\b(texas|california|new york|ohio|georgia|michigan|illinois|pennsylvania|new jersey|arizona|colorado|virginia|north carolina|massachusetts|washington|oregon|nevada|maryland|connecticut|minnesota|wisconsin|missouri|louisiana|kentucky|tennessee|indiana|alabama|south carolina|oklahoma|arkansas|iowa|mississippi|kansas|utah|nebraska|west virginia|idaho|hawaii|maine|new hampshire|rhode island|montana|delaware|south dakota|north dakota|alaska|vermont|wyoming|new mexico)\b/i.test(q))
    return 'Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Every donation helps us expand to new states -- visit jackpot.allaml.ai to donate and help make it happen!';
  return 'I can answer questions about Fantasy 5 payouts, odds, taxes, EZMatch, draw schedule, and more.\n\nTry asking:\n- "What do I win for 4 of 5?"\n- "Take-home on $500"\n- "Spent $30 won $10 -- what is my loss?"\n- "How does EZMatch work?"\n- "When is the next drawing?"\n\nNote: Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Donate at jackpot.allaml.ai and help us expand!';
}

let lastAutoRefreshF5 = null;
let autoRefreshF5Promise = null;

async function ensureDailyRefreshF5() {
  const today = todayET();
  if (lastAutoRefreshF5 === today) return;
  if (autoRefreshF5Promise) return autoRefreshF5Promise;
  autoRefreshF5Promise = downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => {
    lastAutoRefreshF5 = today;
    autoRefreshF5Promise = null;
    console.log('Auto-refreshed Fantasy 5 PDF for ' + today);
  }).catch(err => {
    autoRefreshF5Promise = null;
    console.warn('Fantasy 5 auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshF5Promise;
}

app.get('/nextdraw/fantasy5', (req, res) => res.json(getNextDrawFantasy5()));

app.get('/analyze/fantasy5', async (req, res) => {
  try {
    await ensureDailyRefreshF5();
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    res.json(await runAnalysisFantasy5(count, sid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/refresh/fantasy5', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => {
    lastAutoRefreshF5 = null; return appendFantasy5Deltas();
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'fantasy5' });
});

// ── Draw lookup via scrape (fast, no PDF parse) ───────────────────────────────
// Scrapes the FL Lottery winning numbers page for a specific date.
// Falls back with a link to the official page if not found.

// Puppeteer browser instance cache — reuse across requests
let _browser = null;
const _scrapeCache = {};
const _scrapeInFlight = {}; // key -> Promise, deduplicates concurrent scrapes for same date
let _scrapeGlobalLock = Promise.resolve(); // ensures only one Chrome instance runs at a time
async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--no-first-run'], executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
  }
  return _browser;
}
async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch(_) {} _browser = null; }
}

const JACKPOT_GAME_URLS = {
  jtp:          'https://floridalottery.com/games/draw-games/jackpot-triple-play',
  lottox:       'https://floridalottery.com/games/draw-games/florida-lotto',
  fantasy5:     'https://floridalottery.com/games/draw-games/fantasy5',
  powerball:    'https://floridalottery.com/games/draw-games/powerball',
  megamillions: 'https://floridalottery.com/games/draw-games/mega-millions'
};
const _jackpotCache = {}; // game -> { amount, ts }, 5-minute TTL

// Extract jackpot amount from a scraped page HTML and cache it for the given game
function saveJackpotCacheToFile() {
  try {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(JACKPOT_CACHE_PATH, 'utf8')); } catch(e) {}
    Object.assign(existing, _jackpotCache);
    fs.writeFileSync(JACKPOT_CACHE_PATH, JSON.stringify(existing));
  } catch(e) {}
}

function extractAndCacheJackpot(game, html) {
  if (!['jtp','lottox','fantasy5','powerball'].includes(game)) return;
  const now = Date.now();
  if (_jackpotCache[game] && now - _jackpotCache[game].ts < 5 * 60 * 1000) return; // still fresh
  // Primary: FL Lottery renders jackpot in a span with class="draw-game-jackpot"
  const classM = html.match(/draw-game-jackpot[^>]*>([^<]+)</);
  if (classM) {
    const amount = classM[1].trim();
    // Reject placeholder/error values that indicate the page didn't fully render
    if (!amount || amount === 'Not Available' || amount === 'N/A' || amount.length < 2) return;
    _jackpotCache[game] = { amount, ts: now };
    console.log('Jackpot cached from scrape ' + game + ': ' + amount);
    saveJackpotCacheToFile();
    return;
  }
  // Fallback: labeled patterns (no broad /jackpot/ fallback -- it matches prize table entries)
  const patterns = [
    /estimated jackpot[^<]{0,80}\$(\d[\d,\.]+\s*(?:[Mm]illion|[Bb]illion)?)/i,
    /current jackpot[^<]{0,80}\$(\d[\d,\.]+\s*(?:[Mm]illion|[Bb]illion)?)/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      const amount = '$' + m[1].trim();
      _jackpotCache[game] = { amount, ts: now };
      console.log('Jackpot cached from scrape ' + game + ': ' + amount);
      saveJackpotCacheToFile();
      return;
    }
  }
}

async function scrapeFlDraws(game, dateStr, drawType) {
  const _key = game + '|' + dateStr + '|' + (drawType || '');
  if (_scrapeInFlight[_key]) return _scrapeInFlight[_key];
  // Serialize through global lock -- only one Chrome instance at a time across all games/dates
  _scrapeInFlight[_key] = _scrapeGlobalLock.then(() => _scrapeFlDrawsImpl(game, dateStr, drawType)).finally(function() { delete _scrapeInFlight[_key]; });
  _scrapeGlobalLock = _scrapeInFlight[_key].catch(() => {});
  return _scrapeInFlight[_key];
}
async function _scrapeFlDrawsImpl(game, dateStr, drawType) {
  const GAME_URLS = {
    jtp:      'https://floridalottery.com/games/draw-games/jackpot-triple-play',
    lottox:   'https://floridalottery.com/games/draw-games/florida-lotto',
    fantasy5: 'https://floridalottery.com/games/draw-games/fantasy5',
    cashpop: 'https://floridalottery.com/games/draw-games/cash-pop'
  };
  const GAME_IDS = { jtp: 'jackpottripleplay', lottox: 'lotto', fantasy5: 'fantasy5', cashpop: 'cashpop' };
  const url = GAME_URLS[game];
  const gameId = GAME_IDS[game];
  if (!url) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const isoDate = parts[2] + '-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0');
  const articleId = isoDate + '-' + gameId;
  const pageUrl = url;
  const _ck = game + '|' + dateStr + '|' + (drawType || '');
  if (_scrapeCache[_ck]) return _scrapeCache[_ck];
  console.log('Puppeteer scraping:', game, dateStr, drawType || '');
  for (let _try = 0; _try < 2; _try++) {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    try { await page.waitForSelector('.game-numbers__number, .draw-results-item', { timeout: 5000 }); } catch(_) {}
    const html = await page.content();
    await page.close();
    await closeBrowser();
    extractAndCacheJackpot(game, html); // opportunistically cache jackpot from this page load
    const idx = html.indexOf(articleId);
    if (idx === -1 && game !== 'cashpop') return null;
    const chunk = game === 'cashpop' ? html : html.slice(idx, idx + (game === 'fantasy5' ? 4000 : 2000));
    // For Lotto X: strip Double Play section before extracting numbers
    const searchChunk = game === 'lottox'
      ? (chunk.includes('Double Play') ? chunk.slice(0, chunk.indexOf('Double Play')) : chunk)
      : chunk;
    if (game === 'fantasy5') {
      // Article has both Midday and Evening — slice between the two labels
      const dtLabel = (!drawType || drawType === 'MIDDAY') ? 'Midday' : 'Evening';
      const otherLabel = dtLabel === 'Midday' ? 'Evening' : 'Midday';
      const dtIdx = chunk.indexOf(dtLabel);
      if (dtIdx === -1) return null;
      const otherIdx = chunk.indexOf(otherLabel, dtIdx + dtLabel.length);
      const block = chunk.slice(dtIdx, otherIdx !== -1 ? otherIdx : dtIdx + 600);
      const numRe2 = /class="game-numbers__number"><span>(\d+)<\/span>/g;
      const nums2 = []; let m2;
      while ((m2 = numRe2.exec(block)) !== null) nums2.push(parseInt(m2[1]));
      const resolvedType = dtLabel.toUpperCase();
      if (nums2.length) { const _r = { numbers: nums2, drawType: resolvedType }; _scrapeCache[_ck] = _r; return _r; }
    }
    const numRe = /class="game-numbers__number"><span>(\d+)<\/span>/g;
    const nums = []; let m;
    while ((m = numRe.exec(searchChunk)) !== null) nums.push(parseInt(m[1]));
    if (game === 'cashpop') {
      // Cash Pop: no article ID — search whole page, filter by date
      // Convert dateStr MM/DD/YYYY to short form like "Nov 18"
      const dateParts = dateStr.split('/');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const shortDate = months[parseInt(dateParts[0])-1] + ' ' + parseInt(dateParts[1]);
      // Find the section for this date
      const dateIdx = searchChunk.indexOf(shortDate);
      const dateChunk = dateIdx !== -1 ? searchChunk.slice(Math.max(0, dateIdx - 500), dateIdx + 2000) : searchChunk;
      const liRe = /<li[^>]*>.*?<div[^>]*>([^<]+)<\/div>.*?game-numbers__number[^>]*>(\d+)/gs;
      const sessions = []; let ms;
      while ((ms = liRe.exec(dateChunk)) !== null) {
        const name = ms[1].trim();
        const num = parseInt(ms[2]);
        if (name && num >= 1 && num <= 15) sessions.push({ name, number: num });
      }
      if (sessions.length) {
        // Return most recent session (last in list) or match drawType if specified
        const session = drawType ? sessions.find(s => s.name.toUpperCase() === drawType.toUpperCase()) || sessions[sessions.length-1] : sessions[sessions.length-1];
        const _r = { numbers: [session.number], drawType: session.name, sessions }; _scrapeCache[_ck] = _r; return _r;
      }
      return null;
    }
    if (!nums.length) return null;
    const _r = { numbers: nums, drawType: drawType || '' }; _scrapeCache[_ck] = _r; return _r;
  } catch (e) {
    console.warn('Puppeteer scrape attempt ' + (_try+1) + ' failed:', e.message);
    if (_try === 0) { _browser = null; } // reset so getBrowser() relaunches fresh
    continue;
  }
  break; // success — exit retry loop
  } // end retry loop
}

const FL_RESULTS_URLS = {
  jtp:      'https://www.floridalottery.com/games/draw-games/jackpot-triple-play',
  lottox:   'https://www.floridalottery.com/games/draw-games/florida-lotto',
  fantasy5: 'https://floridalottery.com/games/draw-games/fantasy5',
  cashpop: 'https://floridalottery.com/games/draw-games/cash-pop'
};

// Normalize date from MM/DD/YYYY (picker) to MM/DD/YY (PDF format)
function normDateForPDF(date) {
  const p = date.split('/');
  if (p.length !== 3) return date;
  const yy = p[2].length === 4 ? p[2].slice(2) : p[2];
  return p[0] + '/' + p[1] + '/' + yy;
}
function stripLeadingZeros(date) {
  const p = date.split('/');
  if (p.length !== 3) return date;
  return parseInt(p[0]) + '/' + parseInt(p[1]) + '/' + p[2];
}


function isValidDrawDay(dateStr, days) {
  const p = dateStr.split('/');
  if (p.length !== 3) return true; // can't parse, let it through
  const yy = parseInt(p[2].length === 2 ? '20' + p[2] : p[2]);
  const d = new Date(Date.UTC(yy, parseInt(p[0]) - 1, parseInt(p[1])));
  return days.includes(d.getUTCDay());
}

app.get('/draws/jtp', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!isValidDrawDay(date, [2, 5])) return res.status(404).json({ error: 'No JTP draw on that date (draws Tue & Fri).', resultsUrl: FL_RESULTS_URLS.jtp });
  const pdfDate = normDateForPDF(date);
  try {
    const draws = getJtpDraws();
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers });
  } catch (e) {}
  // JSON only -- no scraper (Chrome crashes on Fly.io). Show official results link for missing dates.
  delete _availCache['jtp'];
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.jtp });
});

app.get('/draws/lottox', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!isValidDrawDay(date, [3, 6])) return res.status(404).json({ error: 'No Lotto X draw on that date (draws Wed & Sat).', resultsUrl: FL_RESULTS_URLS.lottox });
  const pdfDate = normDateForPDF(date);
  try {
    const draws = getLottoXDraws();
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers });
  } catch (e) {}
  // JSON only -- no scraper (Chrome crashes on Fly.io). Show official results link for missing dates.
  delete _availCache['lottox'];
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.lottox });
});

app.get('/draws/fantasy5', async (req, res) => {
  const { date, draw } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  const type = (draw || '').toUpperCase();
  const pdfDate = normDateForPDF(date);
  try {
    const draws = getFantasy5Draws();
    const match = draws.find(d => (stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date) && (!type || d.drawType === type));
    if (match) return res.json({ date: match.date, drawType: match.drawType, numbers: match.numbers });
  } catch (e) {}
  // JSON only -- no scraper (Chrome crashes on Fly.io). Show official results link for missing dates.
  delete _availCache['fantasy5'];
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.fantasy5 });
});

// Available dates cache (10 min TTL per game)
const _availCache = {};
async function getAvailableDates(game) {
  const now = Date.now();
  if (_availCache[game] && now - _availCache[game].ts < 5 * 60 * 1000) return _availCache[game].dates;
  const GAME_URLS = {
    jtp:      'https://floridalottery.com/games/draw-games/jackpot-triple-play',
    lottox:   'https://floridalottery.com/games/draw-games/florida-lotto',
    fantasy5: 'https://floridalottery.com/games/draw-games/fantasy5',
    cashpop: 'https://floridalottery.com/games/draw-games/cash-pop'
  };
  const GAME_IDS = { jtp: 'jackpottripleplay', lottox: 'lotto', fantasy5: 'fantasy5', cashpop: 'cashpop' };
  for (let _try = 0; _try < 2; _try++) {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(GAME_URLS[game], { waitUntil: 'domcontentloaded', timeout: 15000 });
    try { await page.waitForSelector('.game-numbers__number, .draw-results-item', { timeout: 5000 }); } catch(_) {}
    const html = await page.content();
    await page.close();
    await closeBrowser();
    extractAndCacheJackpot(game, html); // opportunistically cache jackpot
    const re = new RegExp('(\\d{4}-\\d{2}-\\d{2})-' + GAME_IDS[game], 'g');
    const dates = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!dates.includes(m[1])) dates.push(m[1]);
    }
    // Convert YYYY-MM-DD to MM/DD/YYYY for frontend
    const converted = dates.map(d => {
      const [y, mo, day] = d.split('-');
      return mo + '/' + day + '/' + y;
    });
    if (converted.length) _availCache[game] = { dates: converted, ts: now };
    return converted;
  } catch (e) {
    if (_try === 0) { _browser = null; continue; } // reset so getBrowser() relaunches fresh
    return [];
  }
  break;
  } // end retry loop
  return [];

}
function expandYear(date) {
  const p = date.split('/');
  if (p.length !== 3) return date;
  return p[0] + '/' + p[1] + '/' + (p[2].length === 2 ? '20' + p[2] : p[2]);
}

app.get('/draws/jtp/available', async (req, res) => {
  try {
    const draws = getJtpDraws();
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===2||day===5; });
    const dates = filtered.slice(0, 5).map(d => expandYear(d.date));
    // Stale check: find most recent Tue(2) or Fri(5) that has passed in ET
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const drawCutoff = new Date(nowET); drawCutoff.setHours(23, 15, 0, 0);
    let check = new Date(nowET);
    // Walk back to find most recent Tue or Fri that has passed its 11:15 PM draw
    for (let i = 0; i < 7; i++) {
      const d = check.getDay();
      if ((d === 2 || d === 5) && (i > 0 || nowET >= drawCutoff)) {
        const mo = String(check.getMonth() + 1).padStart(2, '0');
        const dy = String(check.getDate()).padStart(2, '0');
        const missingDate = mo + '/' + dy + '/' + check.getFullYear();
        if (!dates.includes(missingDate)) dates.unshift(missingDate);
        break;
      }
      check.setDate(check.getDate() - 1);
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/lottox/available', async (req, res) => {
  try {
    const draws = getLottoXDraws();
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===3||day===6; });
    const dates = filtered.slice(0, 5).map(d => expandYear(d.date));
    // Stale check: find most recent Wed(3) or Sat(6) that has passed in ET
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const drawCutoff = new Date(nowET); drawCutoff.setHours(23, 15, 0, 0);
    let check = new Date(nowET);
    for (let i = 0; i < 7; i++) {
      const d = check.getDay();
      if ((d === 3 || d === 6) && (i > 0 || nowET >= drawCutoff)) {
        const mo = String(check.getMonth() + 1).padStart(2, '0');
        const dy = String(check.getDate()).padStart(2, '0');
        const missingDate = mo + '/' + dy + '/' + check.getFullYear();
        if (!dates.includes(missingDate)) dates.unshift(missingDate);
        break;
      }
      check.setDate(check.getDate() - 1);
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/fantasy5/available', async (req, res) => {
  try {
    const draws = getFantasy5Draws();
    const now = Date.now();
    const valid = draws.filter(d => d.ts <= now);
    const seen = new Set(); const dates = [];
    for (const d of valid) {
      const key = d.date; if (seen.has(key)) continue; seen.add(key);
      dates.push(expandYear(d.date));
      if (dates.length >= 5) break;
    }
    // Stale check: if today has had a draw (1:05 PM or 11:15 PM ET) and it's not in the list, prepend it
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const h = nowET.getHours(), m = nowET.getMinutes();
    const passedMidday = h > 13 || (h === 13 && m >= 5);
    const passedEvening = h > 23 || (h === 23 && m >= 15);
    if (passedMidday || passedEvening) {
      const mo = String(nowET.getMonth() + 1).padStart(2, '0');
      const dy = String(nowET.getDate()).padStart(2, '0');
      const todayFull = mo + '/' + dy + '/' + nowET.getFullYear();
      if (!dates.includes(todayFull)) dates.unshift(todayFull);
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/cashpop/available', async (req, res) => {
  try {
    const draws = getCpDraws();
    const dates = draws.slice(0, 5).map(d => expandYear(d.date));
    // Return the 5 most recent dates from the JSON.
    // CP PDF updates once per day (end of day) -- today's data won't appear until appendCpDeltas() runs tonight.
    // Don't prepend today speculatively -- it would trigger the scraper which is unstable.
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});

app.get('/draws/cashpop', async (req, res) => {
  const { date, session } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  // PDF fallback first - has 5 numbers per date (one per session)
  try {
    const draws = getCpDraws();
    const pdfDate = normDateForPDF(date);
    const match = draws.find(d => d.date === date || d.date === pdfDate);
    if (match) {
      const sessions = ['Morning','Matinee','Afternoon','Evening','Late Night'];
      const allSessions = match.numbers.map((n, i) => ({ name: sessions[i], number: n }));
      const target = session ? allSessions.find(s => s.name.toLowerCase() === session.toLowerCase()) : allSessions[allSessions.length-1];
      if (target) return res.json({ date, session: target.name, number: target.number, allSessions });
    }
  } catch(e) {}
  // JSON only -- no scraper (Chrome crashes on Fly.io). Show official results link for missing dates.
  delete _availCache['cashpop'];
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.cashpop });
});

app.get('/latestdraw/jtp', async (req, res) => {
  try {
    const draws = getJtpDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/lottox', async (req, res) => {
  try {
    const draws = getLottoXDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/fantasy5', async (req, res) => {
  try {
    const draws = getFantasy5Draws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const evening = draws.find(d => d.drawType === 'EVENING');
    const midday  = draws.find(d => d.drawType === 'MIDDAY');
    res.json({
      evening: evening ? { date: evening.date, numbers: evening.numbers, drawType: 'EVENING' } : null,
      midday:  midday  ? { date: midday.date,  numbers: midday.numbers,  drawType: 'MIDDAY'  } : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/cashpop', async (req, res) => {
  try {
    const draws = getCpDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
function getLastDrawTime(game) {
  // Returns the most recent draw time in ET as a Date, or null if no draw has occurred today/recently
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = nowET.getHours(), m = nowET.getMinutes();
  const nowMins = h * 60 + m;
  const today = new Date(nowET); today.setSeconds(0, 0);

  const drawSchedules = {
    powerball: [{ days: [1, 3, 6], h: 22, m: 59 }],  // Mon, Wed, Sat 10:59 PM
    megamillions: [{ days: [2, 5], h: 23, m: 0 }],   // Tue, Fri 11:00 PM
    jtp:     [{ days: [2, 5], h: 23, m: 15 }],  // Tue, Fri 11:15 PM
    lottox:  [{ days: [3, 6], h: 23, m: 15 }],  // Wed, Sat 11:15 PM
    fantasy5:[{ days: null,   h: 13, m:  5 }, { days: null, h: 23, m: 15 }], // daily 1:05 PM + 11:15 PM
    cashpop: [{ days: null,   h:  7, m: 29 }, { days: null, h: 11, m: 29 },
              { days: null,   h: 14, m: 29 }, { days: null, h: 18, m: 29 },
              { days: null,   h: 22, m: 29 }],
  };

  const schedules = drawSchedules[game];
  if (!schedules) return null;

  const day = nowET.getDay();
  let lastDraw = null;

  for (const s of schedules) {
    if (s.days && !s.days.includes(day)) continue;
    const drawMins = s.h * 60 + s.m;
    if (nowMins >= drawMins) {
      const d = new Date(today); d.setHours(s.h, s.m, 0, 0);
      if (!lastDraw || d > lastDraw) lastDraw = d;
    }
  }

  // Also check yesterday for games that may have drawn last night
  if (!lastDraw) {
    const yestET = new Date(nowET); yestET.setDate(yestET.getDate() - 1);
    const yestDay = yestET.getDay();
    for (const s of schedules) {
      if (s.days && !s.days.includes(yestDay)) continue;
      const d = new Date(yestET); d.setHours(s.h, s.m, 0, 0);
      if (!lastDraw || d > lastDraw) lastDraw = d;
    }
  }

  return lastDraw;
}

function isDataStaleForGame(game, dataTs) {
  // Data is stale if: a draw has occurred AND it's been >30 min since that draw AND data predates the draw
  const lastDraw = getLastDrawTime(game);
  if (!lastDraw) return false;
  const now = Date.now();
  const drawTs = lastDraw.getTime();
  const thirtyMinAfterDraw = drawTs + 30 * 60 * 1000;
  // Stale if: draw happened, 30 min grace period passed, and our data is older than the draw
  return now >= thirtyMinAfterDraw && dataTs < drawTs;
}

async function scrapeJackpot(game) {
  // 1. In-memory cache -- fresh if not stale since last draw
  if (_jackpotCache[game] && !isDataStaleForGame(game, _jackpotCache[game].ts)) return _jackpotCache[game].amount;
  // 2. File cache -- populated by post-draw refresh
  try {
    const fileCache = JSON.parse(fs.readFileSync(JACKPOT_CACHE_PATH, 'utf8'));
    if (fileCache[game] && !isDataStaleForGame(game, fileCache[game].ts)) {
      _jackpotCache[game] = fileCache[game];
      return fileCache[game].amount;
    }
  } catch(e) {}
  // 3. Cache cold or stale -- return null, frontend shows "See FL Lottery"
  // Post-draw schedule calls forceRefreshJackpot() which does the actual Puppeteer scrape
  return null;
}

async function forceRefreshJackpot(game) {
  const url = JACKPOT_GAME_URLS[game];
  if (!url) return;
  for (let _try = 0; _try < 2; _try++) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
      const html = await page.content();
      await page.close();
      await closeBrowser();
      extractAndCacheJackpot(game, html);
      return;
    } catch(e) {
      console.warn('forceRefreshJackpot attempt ' + (_try+1) + ' failed for ' + game + ': ' + e.message);
      if (_try === 0) { _browser = null; }
    }
  }
}

app.get('/jackpot', async (req, res) => {
  const game = (req.query.game || '').toLowerCase();
  if (!JACKPOT_GAME_URLS[game]) return res.status(400).json({ error: 'game must be jtp, lottox, fantasy5, powerball or megamillions' });
  try {
    const amount = await scrapeJackpot(game);
    res.json({ game, amount });
  } catch(err) { res.json({ game, amount: null }); }
});

// Force jackpot refresh is intentionally NOT exposed as a user-facing route.
// forceRefreshJackpot() is only called from schedulePostDrawRefreshes() via _scrapeGlobalLock.
// See steering rules: OOM safety section.

app.post('/check/fantasy5', (req, res) => {
  const { drawn, line } = req.body;
  if (!Array.isArray(drawn) || drawn.length !== 5 || !Array.isArray(line) || line.length !== 5)
    return res.status(400).json({ error: 'Provide drawn (5 numbers) and line (5 numbers).' });
  const drawnSet = new Set(drawn.map(Number));
  const nums = line.map(Number);
  const matched = nums.filter(n => drawnSet.has(n));
  const count = matched.length;
  const PRIZES = { 5: 'JACKPOT', 4: 500, 3: 10, 2: 'FREE', 1: 0, 0: 0 };
  const raw = PRIZES[count];
  let prize = 0, prizeDisplay;
  if (raw === 'JACKPOT')   { prizeDisplay = 'JACKPOT'; }
  else if (raw === 'FREE') { prizeDisplay = 'Free Quick Pick'; }
  else if (raw > 0)        { prize = raw; prizeDisplay = 'approx $' + prize.toLocaleString(); }
  else                     { prizeDisplay = 'No prize'; }
  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' });
});

app.post('/chat/fantasy5', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyFantasy5(message, context) });
});

// ── Post-draw scheduled PDF refresh ─────────────────────────────────────────
// Fantasy 5: daily at 1:10 PM and 11:20 PM ET (5 min after each draw)
// Cash Pop: daily at 7:34, 11:34 AM, 2:34, 6:34, 10:34 PM ET (5 min after each draw)
// JTP and Lotto X keep once-per-day refresh on first /analyze call (twice-weekly draws)

function msUntilNextET(hour, min) {
  const now = new Date();
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const target = new Date(nowET);
  target.setHours(hour, min, 0, 0);
  if (target <= nowET) target.setDate(target.getDate() + 1);
  return target - nowET;
}

function scheduleDaily(hour, min, fn) {
  setTimeout(function fire() {
    fn();
    setTimeout(fire, 24 * 60 * 60 * 1000);
  }, msUntilNextET(hour, min));
}

// ── PICK Daily Games (Pick 2, 3, 4, 5) ─────────────────────────────────────

// Prize tables (base prizes at $1.00 play; 50c play = half)
const PICK_PRIZES = {
  pick2: {
    straight: 100,
    box: { 2: 50 },
    sb: { 2: 75 },   // straight half + box half
    combo: null,
    fireball: { straight: 50, box: 25 }
  },
  pick3: {
    straight: 500,
    box: { 3: 160, 6: 80 },
    sb: { 3: 330, 6: 290 },
    combo: { 3: 500, 6: 500 },
    fireball: { straight: 200, box3: 40, box6: 20 }
  },
  pick4: {
    straight: 5000,
    box: { 4: 1200, 6: 800, 12: 400, 24: 200 },
    sb: { 4: 3100, 6: 2900, 12: 2700, 24: 2600 },
    combo: { 4: 5000, 6: 5000, 12: 5000, 24: 5000 },
    fireball: { straight: 1500, box4: 300, box6: 200, box12: 100, box24: 50 }
  },
  pick5: {
    straight: 50000,
    box: { 5: 12000, 10: 6000, 20: 3000, 30: 2000, 60: 1000, 120: 500 },
    sb: { 5: 31000, 10: 28000, 20: 26500, 30: 26000, 60: 25500, 120: 25250 },
    combo: { 5: 50000, 10: 50000, 20: 50000, 30: 50000, 60: 50000, 120: 50000 },
    fireball: { straight: 12000, box5: 2500, box10: 1250, box20: 625, box30: 416, box60: 208, box120: 104 }
  }
};

// Box ways by digit count
function getBoxWays(digits) {
  const counts = {};
  digits.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
  const vals = Object.values(counts).sort((a,b) => b-a);
  const n = digits.length;
  let perms = 1;
  for (let i = 1; i <= n; i++) perms *= i;
  let denom = 1;
  vals.forEach(v => { for (let i = 1; i <= v; i++) denom *= i; });
  return perms / denom;
}

// JSON draw caches for JTP and Cash Pop -- no PDF parsing on Fly (same pattern as LX/F5)
const JTP_DRAWS_PATH = path.join(__dirname, 'jtp_draws.json');
const CP_DRAWS_PATH  = path.join(__dirname, 'cashpop_draws.json');
const PB_DRAWS_PATH  = path.join(__dirname, 'powerball_draws.json');
const MM_DRAWS_PATH  = path.join(__dirname, 'megamillions_draws.json');
const PICK_DRAWS_PATHS = {
  pick2: path.join(__dirname, 'pick2_draws.json'),
  pick3: path.join(__dirname, 'pick3_draws.json'),
  pick4: path.join(__dirname, 'pick4_draws.json'),
  pick5: path.join(__dirname, 'pick5_draws.json'),
};
let pickDrawsCache = { pick2: null, pick3: null, pick4: null, pick5: null };

function getPickDraws(game) {
  if (!pickDrawsCache[game]) pickDrawsCache[game] = JSON.parse(fs.readFileSync(PICK_DRAWS_PATHS[game], 'utf8'));
  return pickDrawsCache[game];
}
const JACKPOT_CACHE_PATH = path.join(__dirname, 'jackpot_cache.json');
let jtpDrawsCache = null;
let cpDrawsCache  = null;
let pbDrawsCache  = null;
let mmDrawsCache  = null;

function getJtpDraws() {
  if (!jtpDrawsCache) jtpDrawsCache = JSON.parse(fs.readFileSync(JTP_DRAWS_PATH, 'utf8'));
  return jtpDrawsCache;
}

function getCpDraws() {
  if (!cpDrawsCache) cpDrawsCache = JSON.parse(fs.readFileSync(CP_DRAWS_PATH, 'utf8'));
  return cpDrawsCache;
}

// Delta updaters for JTP and Cash Pop JSON caches
let jtpLastPdfMtime = null;
async function appendJtpDeltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATHS.history).mtimeMs; } catch(e) { return; }
  if (mtime === jtpLastPdfMtime) { console.log('JTP: PDF unchanged, skipping delta.'); return; }
  const existing = getJtpDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
  let text;
  try { text = await extractPDFText(PDF_PATHS.history); } catch(e) { return; }
  jtpLastPdfMtime = mtime;
  const all = parseHistoryPDF(text);
  const newDraws = all.filter(d => d.ts > newestTs);
  if (!newDraws.length) { console.log('JTP: no new draws.'); return; }
  const merged = [...newDraws, ...existing].slice(0, 500);
  jtpDrawsCache = merged;
  fs.writeFileSync(JTP_DRAWS_PATH, JSON.stringify(merged, null, 2));
  console.log('JTP: appended ' + newDraws.length + ' new draws.');
}

let cpLastPdfMtime = null;
async function appendCpDeltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_CP).mtimeMs; } catch(e) { return; }
  if (mtime === cpLastPdfMtime) { console.log('CP: PDF unchanged, skipping delta.'); return; }
  const existing = getCpDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
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
}

// mtime cache for Pick PDFs (~1s parse, under JSON cache threshold)
const pickCache = { pick2: null, pick3: null, pick4: null, pick5: null };
const pickParsePromise = { pick2: null, pick3: null, pick4: null, pick5: null };

async function getPickText(game) {
  let mtime;
  try { mtime = fs.statSync(PDF_PATHS_PICK[game]).mtimeMs; } catch(e) { throw new Error(game + ' PDF not yet downloaded. Try again in a moment.'); }
  if (pickCache[game] && pickCache[game].mtime === mtime) return pickCache[game].text;
  if (!pickParsePromise[game]) {
    pickParsePromise[game] = extractPDFText(PDF_PATHS_PICK[game]).then(text => {
      pickCache[game] = { text, mtime };
      pickParsePromise[game] = null;
      console.log(game + ' PDF cache refreshed.');
      return text;
    });
  }
  return pickParsePromise[game];
}

function parsePickHistoryPDF(text, numDigits) {
  const draws = [];
  // Each row: DATE  D[-D...] FB N  D[-D...] FB N  (midday then evening)
  const digitPat = Array(numDigits).fill('(\\d)').join('\\s*-\\s*');
  const re = new RegExp('(\\d{1,2}/\\d{1,2}/\\d{4})\\s+' + digitPat + '\\s+FB\\s+(\\d)\\s+' + digitPat + '\\s+FB\\s+(\\d)', 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const parts = date.split('/');
    const ts = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    if (ts > Date.now() || ts < new Date('2000-01-01').getTime()) continue;
    const midDigits = [];
    for (let i = 2; i < 2 + numDigits; i++) midDigits.push(parseInt(m[i]));
    const midFB = parseInt(m[2 + numDigits]);
    const eveDigits = [];
    for (let i = 3 + numDigits; i < 3 + numDigits * 2; i++) eveDigits.push(parseInt(m[i]));
    const eveFB = parseInt(m[3 + numDigits * 2]);
    draws.push({ date, drawType: 'MIDDAY',  digits: midDigits, fireball: midFB, ts });
    draws.push({ date, drawType: 'EVENING', digits: eveDigits, fireball: eveFB, ts: ts + 1 });
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function scorePickDigits(digits, draws) {
  const n = digits.length;
  // Positional frequency: how often each digit appears at each position
  const posFreq = Array.from({length: n}, () => Array(10).fill(0));
  draws.forEach(d => d.digits.forEach((dig, pos) => { posFreq[pos][dig]++; }));
  let score = 0;
  digits.forEach((d, pos) => { score += posFreq[pos][d] / Math.max(1, draws.length) * 40; });
  // Recency: how recently each digit appeared at each position
  const recent = draws.slice(0, 50);
  digits.forEach((d, pos) => {
    const lastIdx = recent.map((dr, i) => dr.digits[pos] === d ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });
  // Overall digit frequency across all positions
  const overallFreq = Array(10).fill(0);
  draws.forEach(d => d.digits.forEach(dig => { overallFreq[dig]++; }));
  const maxFreq = Math.max(...overallFreq);
  digits.forEach(d => { score += overallFreq[d] / maxFreq * 10; });
  return score;
}

function generatePickLines(draws, numDigits, count, seenLines) {
  const candidates = [];
  const used = new Set();
  const target = Math.max(3000, count * 50);
  for (let attempt = 0; attempt < target; attempt++) {
    const digits = Array.from({length: numDigits}, () => Math.floor(Math.random() * 10));
    const key = digits.join('');
    if (used.has(key)) continue;
    used.add(key);
    const penalty = seenLines.has(key) ? 30 : 0;
    candidates.push({ digits, score: scorePickDigits(digits, draws) - penalty });
  }
  candidates.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    // Diversity: max 1 shared digit at same position between selected lines
    if (!lines.some(l => l.digits.filter((d, i) => d === c.digits[i]).length >= numDigits - 1)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

function getNextDrawPick() {
  // Same schedule as Fantasy 5: Midday 1:05 PM, Evening 11:15 PM ET, every day
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const drawTimes = [
    { name: 'Midday',  hour: 13, min: 5,  closeH: 12, closeM: 45 },
    { name: 'Evening', hour: 23, min: 15, closeH: 22, closeM: 55 }
  ];
  for (let offset = 0; offset < 2; offset++) {
    const day = new Date(nowET); day.setDate(day.getDate() + offset);
    for (const d of drawTimes) {
      const candidate = new Date(day); candidate.setHours(d.hour, d.min, 0, 0);
      if (candidate > nowET) {
        const salesClose = new Date(candidate); salesClose.setHours(d.closeH, d.closeM, 0, 0);
        const fmt = (h, m) => { const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h > 12 ? h-12 : (h===0?12:h); return h12+':'+String(m).padStart(2,'0')+' '+ap+' ET'; };
        return { drawName: d.name, dayName: DAY_NAMES[candidate.getDay()], date: MON_NAMES[candidate.getMonth()]+' '+candidate.getDate()+', '+candidate.getFullYear(), drawTime: fmt(d.hour, d.min), closeTime: fmt(d.closeH, d.closeM), salesOpen: nowET < salesClose, msUntilDraw: candidate - nowET };
      }
    }
  }
}

function checkPickStraight(played, drawn) {
  return played.every((d, i) => d === drawn[i]);
}

function checkPickBox(played, drawn) {
  const s = [...played].sort().join('');
  const d = [...drawn].sort().join('');
  return s === d;
}

function getFireballCombos(drawn, fb) {
  // Replace each position with fireball digit
  return drawn.map((_, i) => drawn.map((d, j) => j === i ? fb : d));
}

function checkPickWin(played, drawn, fb, playType, game, playAmount) {
  const prizes = PICK_PRIZES[game];
  const mult = playAmount === 0.5 ? 0.5 : 1;
  const results = [];

  // Base game check
  const isStraight = checkPickStraight(played, drawn);
  const ways = getBoxWays(drawn);
  const isBox = checkPickBox(played, drawn);

  if (playType === 'straight') {
    if (isStraight) results.push({ type: 'Straight', prize: Math.round(prizes.straight * mult), base: true });
  } else if (playType === 'box') {
    if (isBox && !isStraight) results.push({ type: 'Box ' + ways + '-way', prize: Math.round((prizes.box[ways] || 0) * mult), base: true });
    else if (isStraight) results.push({ type: 'Box ' + ways + '-way (Straight match)', prize: Math.round((prizes.box[ways] || 0) * mult), base: true });
  } else if (playType === 'sb') {
    // Straight/Box: costs $1 (50c straight + 50c box)
    if (isStraight) results.push({ type: 'Straight/Box - Straight', prize: Math.round(prizes.straight * 0.5), base: true });
    if (isBox) results.push({ type: 'Straight/Box - Box', prize: Math.round((prizes.box[ways] || 0) * 0.5), base: true });
  } else if (playType === 'combo') {
    if (isStraight) results.push({ type: 'Combo - Straight', prize: Math.round(prizes.straight * mult), base: true });
  }

  // Fireball check
  if (fb !== null && fb !== undefined) {
    const fbCombos = getFireballCombos(drawn, fb);
    fbCombos.forEach(fbDrawn => {
      const fbStraight = checkPickStraight(played, fbDrawn);
      const fbBox = checkPickBox(played, fbDrawn);
      const fbWays = getBoxWays(fbDrawn);
      if (playType === 'straight' && fbStraight) {
        results.push({ type: 'Fireball Straight', prize: Math.round((prizes.fireball.straight || 0) * mult), fireball: true });
      } else if (playType === 'box' && fbBox) {
        const fbPrize = prizes.fireball['box' + fbWays] || prizes.fireball.box || 0;
        results.push({ type: 'Fireball Box', prize: Math.round(fbPrize * mult), fireball: true });
      } else if (playType === 'sb') {
        if (fbStraight) results.push({ type: 'Fireball S/B Straight', prize: Math.round((prizes.fireball.straight || 0) * 0.5), fireball: true });
        else if (fbBox) { const fbPrize = prizes.fireball['box' + fbWays] || prizes.fireball.box || 0; results.push({ type: 'Fireball S/B Box', prize: Math.round(fbPrize * 0.5), fireball: true }); }
      }
    });
  }

  const totalPrize = results.reduce((s, r) => s + r.prize, 0);
  const wh = totalPrize > 5000 ? Math.round(totalPrize * 0.24) : 0;
  return { results, totalPrize, withholding: wh, takeHome: totalPrize - wh };
}

function chatReplyPick(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;
  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;

  const gameM = q.match(/pick\s*([2-5])/);
  const g = gameM ? 'pick' + gameM[1] : null;

  if (/straight.*prize|prize.*straight|win.*straight|straight.*win/.test(q)) {
    if (g === 'pick2') return 'Pick 2 Straight ($1.00 play): $100\n50c play: $50\nOdds: 1 in 100\n\nFireball Straight: $50 ($1 play).\nFlorida has no state income tax.';
    if (g === 'pick3') return 'Pick 3 Straight ($1.00 play): $500\n50c play: $250\nOdds: 1 in 1,000\n\nFireball Straight: $200 ($1 play).\nFlorida has no state income tax.';
    if (g === 'pick4') return 'Pick 4 Straight ($1.00 play): $5,000\n50c play: $2,500\nOdds: 1 in 10,000\n\nFireball Straight: $1,500 ($1 play).\nNote: 24% federal withholding applies. Take-home ~$3,800. Florida has no state income tax.';
    if (g === 'pick5') return 'Pick 5 Straight ($1.00 play): $50,000\n50c play: $25,000\nOdds: 1 in 100,000\n\nFireball Straight: $12,000 ($1 play).\nNote: 24% federal withholding applies. Take-home ~$38,000. Florida has no state income tax.';
    return 'PICK Daily Games Straight prizes ($1.00 play, exact order match):\n\n- Pick 2: $100 (odds 1 in 100)\n- Pick 3: $500 (odds 1 in 1,000)\n- Pick 4: $5,000 (odds 1 in 10,000)\n- Pick 5: $50,000 (odds 1 in 100,000)\n\n50c play = half the prize. Pick 4 and Pick 5 exceed $5,000 -- 24% federal withholding applies. Florida has no state income tax.\n\nTip: ask "take-home on $5000" for exact math.';
  }

  if (/box.*prize|prize.*box|win.*box|box.*win/.test(q)) {
    if (g === 'pick2') return 'Pick 2 Box (2-way): $50 at $1 play, $25 at 50c.\nPick 2 only has one box type.';
    if (g === 'pick3') return 'Pick 3 Box prizes ($1.00 play):\n\n- 6-way (all digits different, e.g. 1-2-3): $80\n- 3-way (one pair, e.g. 1-1-2): $160\n\nMore repeated digits = fewer ways = higher prize.';
    if (g === 'pick4') return 'Pick 4 Box prizes ($1.00 play):\n\n- 24-way (all different): $200\n- 12-way (one pair): $400\n- 6-way (two pairs or triple): $800\n- 4-way (triple + unique): $1,200\n\nMore repeated digits = fewer ways = higher prize.';
    if (g === 'pick5') return 'Pick 5 Box prizes ($1.00 play):\n\n- 120-way (all different): $500\n- 60-way: $1,000\n- 30-way: $2,000\n- 20-way: $3,000\n- 10-way: $6,000\n- 5-way (four of a kind + one): $12,000\n\nMore repeated digits = fewer ways = higher prize.';
    return 'PICK Box prizes ($1.00 play):\n\nPick 2: 2-way $50\nPick 3: 3-way $160 | 6-way $80\nPick 4: 4-way $1,200 | 6-way $800 | 12-way $400 | 24-way $200\nPick 5: 5-way $12,000 | 10-way $6,000 | 20-way $3,000 | 30-way $2,000 | 60-way $1,000 | 120-way $500\n\nMore repeated digits = fewer ways = higher prize per win.';
  }

  if (/fireball/.test(q))
    return 'Fireball doubles your ticket cost and adds an extra drawn digit (0-9) after the main draw. It can replace any one of the official drawn digits to create new winning combinations.\n\nNew combinations created:\n- Pick 2 + Fireball: 2 new combos\n- Pick 3 + Fireball: 3 new combos\n- Pick 4 + Fireball: 4 new combos\n- Pick 5 + Fireball: 5 new combos\n\nNote: if the Fireball digit matches an official drawn digit, some combos may be duplicates.\n\nFireball Straight prizes ($1.00 play):\n- Pick 2: $50 | Pick 3: $200 | Pick 4: $1,500 | Pick 5: $12,000\n\nYou can win both a base game prize AND a Fireball prize on the same ticket.';

  if (/combo/.test(q))
    return 'Combo play covers ALL straight combinations of your digits automatically. Cost = $1 x number of combinations.\n\nExamples ($1 play):\n- Pick 3 with 1-2-3 (6-way Combo): costs $6, wins $500 if any order matches\n- Pick 3 with 1-1-2 (3-way Combo): costs $3, wins $500 if any order matches\n- Pick 4 with 1-2-3-4 (24-way Combo): costs $24, wins $5,000 if any order matches\n\nCombo is Box play at the Straight prize level -- you pay for every combination upfront.';

  if (/straight.?box|\bsb\b/.test(q))
    return 'Straight/Box combines a 50c Straight play and a 50c Box play on one ticket for $1 total.\n\nIf your digits match in exact order: you win both the Straight prize AND the Box prize.\nIf your digits match in any other order: you win only the Box prize.\n\nExample (Pick 3, $1 S/B play with 1-2-3):\n- Exact match (1-2-3): $250 Straight + $40 Box = $290 total\n- Any order match (e.g. 3-1-2): $40 Box only';

  if (/play type|how.*play|rules|work/.test(q))
    return 'PICK Daily Games play types:\n\n- Straight: exact order match -- highest prize\n- Box: any order match -- lower prize, more ways to win\n- Straight/Box: half straight + half box on one ticket ($1 total)\n- Combo: covers all straight combinations of your digits (costs more)\n\nFireball add-on doubles cost and adds an extra drawn digit for more winning combinations.\n\nPlay amounts: 50c or $1.00 per panel. Draws: Midday 1:05 PM ET and Evening 11:15 PM ET every day.';

  if (/cost|price|how much|ticket/.test(q))
    return 'PICK Daily Games ticket costs (estimated, subject to change):\n\n- Base play: 50c or $1.00 per panel\n- Fireball add-on: doubles the base cost\n- Combo: $1 x number of combinations (e.g. Pick 3 6-way = $6; Pick 4 24-way = $24)\n\nExamples at $1 Straight:\n- 6 Pick 3 lines: $6 base / $12 with Fireball\n- 6 Pick 5 lines: $6 base / $12 with Fireball\n\nAlways confirm at your retailer.';

  if (/when|draw|time|midday|evening|schedule/.test(q))
    return 'PICK Daily Games draw schedule:\n\n- Midday: 1:05 PM ET every day\n- Evening: 11:15 PM ET every day\n- Midday sales close: ~12:45 PM ET\n- Evening sales close: 10:55 PM ET\n\nAll four PICK games (2, 3, 4, 5) draw at the same times, 7 days a week.';

  if (/odd|chance|probabilit/.test(q))
    return 'PICK Daily Games odds (Straight play):\n\n- Pick 2: 1 in 100\n- Pick 3: 1 in 1,000\n- Pick 4: 1 in 10,000\n- Pick 5: 1 in 100,000\n\nBox play improves odds proportionally to the number of combinations covered.\nExample: Pick 3 6-way Box = 1 in 167 (6x better than Straight).';

  if (/tax|take.?home|withhold/.test(q))
    return 'Tax details for PICK Daily Games:\n\n- Prizes over $5,000: 24% federal withholding\n- Florida: NO state income tax\n- Pick 4 Straight ($5,000) and Pick 5 Straight ($50,000) exceed the threshold\n\nEstimated take-home:\n- Pick 4 Straight $5,000: ~$3,800 after 24% withholding\n- Pick 5 Straight $50,000: ~$38,000 after 24% withholding\n- Pick 5 Fireball $12,000: ~$9,120 after 24% withholding\n\nTip: ask "take-home on $5000" for exact math.';

  if (/cancel|void/.test(q))
    return 'PICK Daily Games cancellation rules:\n\n- Cancel within 2 hours of purchase\n- Cannot cancel after the sales cutoff for that drawing\n- Fireball tickets CANNOT be canceled\n- Free Quick Pick prize tickets cannot be canceled\n- Must cancel at the same retailer that sold the ticket';

  if (/claim|expir|collect|redeem/.test(q))
    return 'PICK prize claim details:\n\n- Prizes expire 180 days from the drawing date\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters';

  if (/advance|multiple.?draw|future.?draw/.test(q))
    return 'Advance Play: play the same digits for up to 30 consecutive days (60 drawings if selecting both Midday and Evening). Fireball applies to all advance play drawings if selected.';

  if (/\b(texas|california|new york|ohio|georgia|michigan|illinois|pennsylvania|new jersey|arizona|colorado|virginia|north carolina|massachusetts|washington|oregon|nevada|maryland|connecticut|minnesota|wisconsin|missouri|louisiana|kentucky|tennessee|indiana|alabama|south carolina|oklahoma|arkansas|iowa|mississippi|kansas|utah|nebraska|west virginia|idaho|hawaii|maine|new hampshire|rhode island|montana|delaware|south dakota|north dakota|alaska|vermont|wyoming|new mexico)\b/i.test(q))
    return 'Jackpot Analyzer currently covers Florida Lottery games only. Want your state added? Every donation helps us expand to new states -- visit jackpot.allaml.ai to donate and help make it happen!';

  return 'I can answer questions about PICK Daily Games (Pick 2, 3, 4, 5) prizes, play types, Fireball, Box ways, odds, taxes, and draw schedule.\n\nTry asking:\n- "What do I win for a Pick 3 straight?"\n- "Pick 4 box prizes"\n- "How does Fireball work?"\n- "What is Straight/Box play?"\n- "Pick 5 odds"\n- "When are the draws?"\n- "Spent $12 won $500 -- what is my ROI?"';
}


// PICK routes
app.get('/nextdraw/pick', (req, res) => res.json(getNextDrawPick()));

app.get('/latestdraw/pick', async (req, res) => {
  const game = (req.query.game || 'pick5').toLowerCase();
  if (!PICK_DRAWS_PATHS[game]) return res.status(400).json({ error: 'Invalid game. Use pick2, pick3, pick4, or pick5.' });
  try {
    const draws = getPickDraws(game);
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const evening = draws.find(d => d.drawType === 'EVENING');
    const midday  = draws.find(d => d.drawType === 'MIDDAY');
    res.json({
      evening: evening ? { date: evening.date, digits: evening.digits, fireball: evening.fireball } : null,
      midday:  midday  ? { date: midday.date,  digits: midday.digits,  fireball: midday.fireball  } : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/draws/pick', async (req, res) => {
  const game = (req.query.game || 'pick5').toLowerCase();
  const { date, draw } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!PDF_PATHS_PICK[game]) return res.status(400).json({ error: 'Invalid game.' });
  const type = (draw || '').toUpperCase();
  const numDigits = parseInt(game.replace('pick',''));
  try {
    const draws = getPickDraws(game);
    const match = draws.find(d => (stripLeadingZeros(d.date) === stripLeadingZeros(date) || d.date === date) && (!type || d.drawType === type));
    if (match) return res.json({ date: match.date, drawType: match.drawType, digits: match.digits, fireball: match.fireball });
  } catch(e) {}
  const gameId = game.replace('pick','pick-');
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: 'https://floridalottery.com/games/draw-games/' + gameId });
});

app.get('/draws/pick/available', async (req, res) => {
  const game = (req.query.game || 'pick5').toLowerCase();
  if (!PICK_DRAWS_PATHS[game]) return res.status(400).json({ error: 'Invalid game.' });
  try {
    const draws = getPickDraws(game);
    const seen = new Set(); const dates = [];
    for (const d of draws) {
      if (seen.has(d.date)) continue; seen.add(d.date);
      dates.push(expandYear(d.date));
      if (dates.length >= 5) break;
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});

app.get('/analyze/pick', async (req, res) => {
  const game = (req.query.game || 'pick5').toLowerCase();
  if (!PDF_PATHS_PICK[game]) return res.status(400).json({ error: 'Invalid game.' });
  try {
    const numDigits = parseInt(game.replace('pick',''));
    const draws = getPickDraws(game);
    if (draws.length < 10) throw new Error('Only ' + draws.length + ' draws parsed.');
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    const sess = sid ? getSession(sid) : { lines: new Set() };
    const lines = generatePickLines(draws, numDigits, count, sess.lines);
    lines.forEach(l => sess.lines.add(l.digits.join('')));
    // Positional frequency stats
    const posFreq = Array.from({length: numDigits}, () => Array(10).fill(0));
    draws.forEach(d => d.digits.forEach((dig, pos) => { posFreq[pos][dig]++; }));
    res.json({
      game, numDigits, totalDraws: draws.length,
      nextDraw: getNextDrawPick(),
      recentHistory: draws.slice(0, 10),
      lines: lines.map((l, i) => ({ line: i+1, digits: l.digits, score: Math.round(l.score * 10) / 10 })),
      posFreq,
      lastUpdated: draws[0] ? draws[0].date : 'unknown'
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/check/pick', (req, res) => {
  const { game, drawn, fireball, played, playType, playAmount } = req.body;
  const g = (game || 'pick5').toLowerCase();
  if (!PICK_PRIZES[g]) return res.status(400).json({ error: 'Invalid game.' });
  const numDigits = parseInt(g.replace('pick',''));
  if (!Array.isArray(drawn) || drawn.length !== numDigits) return res.status(400).json({ error: 'drawn must be ' + numDigits + ' digits (0-9).' });
  if (!Array.isArray(played) || played.length !== numDigits) return res.status(400).json({ error: 'played must be ' + numDigits + ' digits (0-9).' });
  const validTypes = ['straight','box','sb','combo'];
  const pt = (playType || 'straight').toLowerCase();
  if (!validTypes.includes(pt)) return res.status(400).json({ error: 'playType must be straight, box, sb, or combo.' });
  const pa = [0.5, 1].includes(parseFloat(playAmount)) ? parseFloat(playAmount) : 1;
  const fb = (fireball !== null && fireball !== undefined) ? parseInt(fireball) : null;
  const result = checkPickWin(played.map(Number), drawn.map(Number), fb, pt, g, pa);
  res.json({ game: g, drawn: drawn.map(Number), played: played.map(Number), fireball: fb, playType: pt, playAmount: pa, ...result });
});

app.post('/refresh/pick', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {
    enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; }));
  });
  clearSession(sid);
  res.json({ queued: true, games: Object.keys(PDF_URLS_PICK) });
});

app.post('/chat/pick', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyPick(message, context) });
});

// Delta updaters for Pick JSON caches
const pickLastPdfMtime = { pick2: null, pick3: null, pick4: null, pick5: null };

async function appendPickDeltas(game) {
  const pdfPath = PDF_PATHS_PICK[game];
  let mtime;
  try { mtime = fs.statSync(pdfPath).mtimeMs; } catch(e) { return; }
  if (mtime === pickLastPdfMtime[game]) { console.log(game + ': PDF unchanged, skipping delta.'); return; }
  const existing = getPickDraws(game);
  const newestTs = existing.length ? existing[0].ts : 0;
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
}

// ── Powerball ────────────────────────────────────────────────────────────────
// 5 white balls 1-69 + 1 Powerball 1-26. Draws Mon/Wed/Sat ~10:59 PM ET.
// PDF rows: M/D/YY  N N N N N  PB N  [X#]  POWERBALL  (base game only, skip DP rows)

function parsePbHistoryPDF(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+PB\s+(\d{1,2})\s+(?:X\d+\s+)?POWERBALL(?!\s+DP)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (!nums || nums.length < 5) continue;
    const white = nums.slice(0, 5).map(Number).filter(n => n >= 1 && n <= 69);
    const pb = parseInt(m[3]);
    if (white.length !== 5 || pb < 1 || pb > 26) continue;
    const parts = date.split('/');
    let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
    const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    if (ts > Date.now() || ts < new Date('1992-01-01').getTime()) continue;
    draws.push({ date, numbers: white, powerball: pb, ts });
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function getPbDraws() {
  if (!pbDrawsCache) pbDrawsCache = JSON.parse(fs.readFileSync(PB_DRAWS_PATH, 'utf8'));
  return pbDrawsCache;
}

let pbLastPdfMtime = null;
async function appendPbDeltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_PB).mtimeMs; } catch(e) { return; }
  if (mtime === pbLastPdfMtime) { console.log('PB: PDF unchanged, skipping delta.'); return; }
  const existing = getPbDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
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
}

function getNextDrawPowerball() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DRAW_DAYS = [1, 3, 6]; // Mon=1, Wed=3, Sat=6
  const DRAW_H = 22, DRAW_M = 59, CLOSE_H = 22, CLOSE_M = 0;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const candidate = new Date(nowET);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 8; i++) {
    if (DRAW_DAYS.includes(candidate.getDay())) {
      candidate.setHours(DRAW_H, DRAW_M, 0, 0);
      if (candidate > nowET) break;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  const salesClose = new Date(candidate);
  salesClose.setHours(CLOSE_H, CLOSE_M, 0, 0);
  return {
    dayName: DAY_NAMES[candidate.getDay()],
    date: MON_NAMES[candidate.getMonth()] + ' ' + candidate.getDate() + ', ' + candidate.getFullYear(),
    drawTime: '10:59 PM ET', closeTime: '10:00 PM ET',
    salesOpen: nowET < salesClose, msUntilDraw: candidate - nowET
  };
}

function scorePowerball(nums, freq, draws, totalDraws) {
  const numArrays = draws.map(d => d.numbers);
  let score = 0;
  const maxFreq = Math.max(...Object.values(freq));
  nums.forEach(n => { score += (freq[n] || 0) / maxFreq * 40; });
  const recent = numArrays.slice(0, 50);
  nums.forEach(n => {
    const lastIdx = recent.map((d, i) => d.includes(n) ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });
  const pairCounts = {};
  numArrays.forEach(d => {
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) {
        const k = d[i] + '-' + d[j];
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
  });
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const k = Math.min(nums[i],nums[j]) + '-' + Math.max(nums[i],nums[j]);
      score += (pairCounts[k] || 0) / totalDraws * 15;
    }
  const low = nums.filter(n => n <= 34).length;
  score += (2 - Math.abs(low - 2)) * 5;
  const sorted = [...nums].sort((a, b) => a - b);
  score += Math.min((sorted[4] - sorted[0]) / 68, 1) * 10;
  return score;
}

function generatePbLines(freq, pbFreq, draws, count, seenLines) {
  const totalDraws = draws.length;
  const pool = Array.from({ length: 69 }, (_, i) => i + 1)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0)).slice(0, 40);
  const pbPool = Array.from({ length: 26 }, (_, i) => i + 1)
    .sort((a, b) => (pbFreq[b] || 0) - (pbFreq[a] || 0)).slice(0, 16);
  const candidateTarget = Math.max(5000, count * 100);
  const usedCombos = new Set();
  const candidates = [];
  for (let attempt = 0; attempt < candidateTarget; attempt++) {
    const candidate = [];
    const available = [...pool];
    while (candidate.length < 5) {
      const weights = available.map(n => (freq[n] || 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
      candidate.push(available[idx]);
      available.splice(idx, 1);
    }
    candidate.sort((a, b) => a - b);
    const pbIdx = Math.floor(Math.random() * pbPool.length);
    const pb = pbPool[pbIdx];
    const key = candidate.join(',') + '|' + pb;
    if (!usedCombos.has(key)) {
      usedCombos.add(key);
      const penalty = seenLines.has(key) ? 30 : 0;
      candidates.push({ nums: candidate, powerball: pb, score: scorePowerball(candidate, freq, draws, totalDraws) - penalty });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.some(l => l.nums.filter(n => c.nums.includes(n)).length > 3)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

let lastAutoRefreshPB = null;
let autoRefreshPBPromise = null;

async function ensureDailyRefreshPB() {
  const today = todayET();
  if (lastAutoRefreshPB === today) return;
  if (autoRefreshPBPromise) return autoRefreshPBPromise;
  autoRefreshPBPromise = downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => {
    lastAutoRefreshPB = today;
    autoRefreshPBPromise = null;
    console.log('Auto-refreshed Powerball PDF for ' + today);
  }).catch(err => {
    autoRefreshPBPromise = null;
    console.warn('Powerball auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshPBPromise;
}

async function runAnalysisPowerball(count, sid) {
  const draws = getPbDraws();
  if (draws.length < 10) throw new Error('Only ' + draws.length + ' Powerball draws in cache.');
  const freq = {}, pbFreq = {};
  draws.forEach(d => {
    d.numbers.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    pbFreq[d.powerball] = (pbFreq[d.powerball] || 0) + 1;
  });
  const sess = sid ? getSession(sid) : { lines: new Set() };
  const lines = generatePbLines(freq, pbFreq, draws, count, sess.lines);
  lines.forEach(l => sess.lines.add(l.nums.join(',') + '|' + l.powerball));
  const freqStats = Object.entries(freq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  const pbFreqStats = Object.entries(pbFreq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  return {
    totalDraws: draws.length, nextDraw: getNextDrawPowerball(),
    recentHistory: draws.slice(0, 10),
    lines: lines.map((l, i) => ({ line: i + 1, numbers: l.nums, powerball: l.powerball, score: Math.round(l.score * 10) / 10 })),
    topNumbers: freqStats.slice(0, 10), bottomNumbers: freqStats.slice(-10).reverse(),
    topPowerballs: pbFreqStats.slice(0, 5),
    lastUpdated: draws[0] ? draws[0].date : 'unknown'
  };
}

function chatReplyPowerball(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;
  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;
  const taxM = q.match(/(?:take.?home|after.?tax|net|lump.?sum|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|lump.?sum|keep)/i) ||
               q.match(/(?:tax|take.?home|net|keep).{0,20}(\d[\d,]+)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 2000000000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      const net = raw - wh;
      const ann = raw > 1000000 ? '\n- Annuity (30 yrs): ~$' + Math.round(raw / 30).toLocaleString() + '/yr before tax' : '';
      return 'Prize: $' + raw.toLocaleString() + ann +
        '\n- Federal withholding (24%): -$' + wh.toLocaleString() +
        '\n- Florida state tax: $0' +
        '\n- Estimated take-home: ~$' + net.toLocaleString() +
        '\n\nNote: Additional federal tax may be owed at filing (up to 37%). Consult a tax professional.';
    }
  }
  const matchM = q.match(/(\d).{0,10}(?:of|out of).{0,5}5.{0,20}(?:plus|\+|with|and).{0,10}powerball/i) ||
                 q.match(/powerball.{0,20}(\d).{0,10}(?:of|out of).{0,5}5/i);
  if (matchM) {
    const m = parseInt(matchM[1]);
    const prizes = { 5: 'Jackpot', 4: '$50,000', 3: '$100', 2: '$7', 1: '$4', 0: '$4' };
    if (m >= 0 && m <= 5) return m + ' of 5 + Powerball: ' + (prizes[m] || 'No prize') + '\n\nTip: ask "take-home on $50000" for exact math.';
  }
  const simpleM = q.match(/(\d).{0,10}(?:of|out of).{0,5}5(?!.*powerball)/i);
  if (simpleM) {
    const m = parseInt(simpleM[1]);
    const prizes = { 5: '$1,000,000', 4: '$100', 3: '$7', 2: 'No prize', 1: 'No prize', 0: 'No prize' };
    if (m >= 0 && m <= 5) return m + ' of 5 (no Powerball): ' + (prizes[m] || 'No prize');
  }
  if (/power.?play/.test(q))
    return 'Power Play (+$1) multiplies non-jackpot prizes by 2x, 3x, 4x, 5x, or 10x (10x only when jackpot is $150M or less).\n\nException: 5-of-5 (Match 5, no Powerball) is always boosted to $2,000,000 with Power Play regardless of the multiplier drawn.\n\nPower Play does NOT apply to the jackpot.\n\nMultiplier odds (jackpot <= $150M): 10x is 1 in 43 | 5x is 1 in 21.5 | 4x is 1 in 14.3 | 3x is 1 in 3.3 | 2x is 1 in 1.8';
  if (/double.?play/.test(q))
    return 'Double Play (+$1) uses your same 6 numbers in a separate drawing held after the main Powerball draw.\n\nDouble Play top prize: $10,000,000 (fixed). All other Double Play prizes are set amounts.\nDouble Play cannot be multiplied by Power Play.\nOverall Double Play odds: 1 in 24.87';
  if (/jackpot|prize|win|payout|how much|worth/.test(q))
    return 'Powerball prizes (per play):\n\n- 5 of 5 + PB (Jackpot): pari-mutuel, starts ~$20M\n- 5 of 5 (no PB): $1,000,000\n- 4 of 5 + PB: $50,000\n- 4 of 5: $100\n- 3 of 5 + PB: $100\n- 3 of 5: $7\n- 2 of 5 + PB: $7\n- 1 of 5 + PB: $4\n- 0 of 5 + PB: $4\n\nOverall odds: 1 in 24.87\n\nAdd Power Play (+$1) to multiply non-jackpot prizes up to 10x.';
  if (/odd|chance|probabilit/.test(q))
    return 'Powerball odds (per play):\n\n- Jackpot (5+PB): 1 in 292,201,338\n- 5 of 5 (no PB): 1 in 11,688,054\n- 4 of 5 + PB: 1 in 913,129\n- 4 of 5: 1 in 36,525\n- 3 of 5 + PB: 1 in 14,494\n- 3 of 5: 1 in 580\n- 2 of 5 + PB: 1 in 701\n- 1 of 5 + PB: 1 in 92\n- 0 of 5 + PB: 1 in 38\n- Any prize: 1 in 24.87';
  if (/cost|price|how much|ticket.{0,10}cost|how much.{0,10}play|spend/.test(q))
    return 'Powerball ticket costs (estimated, subject to change):\n\n- Base play: $2 per play\n- Power Play add-on: +$1 per play\n- Double Play add-on: +$1 per play\n\nExamples:\n- 1 play base: $2\n- 1 play + Power Play: $3\n- 6 plays base: $12\n- 6 plays + both add-ons: $24\n\nAlways confirm at your retailer.';
  if (/how.{0,10}play|rules|work|ticket/.test(q))
    return 'How to play Powerball:\n\n- Cost: $2 per play\n- Pick 5 numbers from 1-69 (white balls) + 1 Powerball from 1-26\n- Drawings: Monday, Wednesday & Saturday at ~10:59 PM ET\n- Sales close at 10:00 PM ET on draw nights\n- Add Power Play (+$1) to multiply non-jackpot prizes\n- Add Double Play (+$1) for a bonus drawing with a $10M top prize\n- Jackpot paid as 30-year annuity or cash lump sum (~60%)';
  if (/when|draw|schedul|time|day|monday|wednesday|saturday/.test(q))
    return 'Powerball drawing schedule:\n\n- Draw days: Monday, Wednesday & Saturday\n- Draw time: ~10:59 PM Eastern Time\n- Sales close: 10:00 PM ET on draw nights\n- Tickets purchased after 10:00 PM go into the next drawing';
  if (/lump|cash|annuit|payment|option/.test(q))
    return 'Powerball jackpot payment options:\n\n- Annuity: 30 annual payments, increasing each year\n- Cash lump sum: ~60% of advertised jackpot, paid immediately\n- Must elect cash option within 60 days of the drawing\n- Both options subject to 24% federal withholding\n- Florida has NO state income tax';
  if (/cancel|void/.test(q))
    return 'Powerball tickets cannot be canceled once printed. Jackpot Combo tickets also cannot be canceled.';
  if (/claim|expir|collect|redeem/.test(q))
    return 'Powerball prize claim:\n\n- Prizes expire 180 days from the drawing date\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters\n- Must elect lump sum within 60 days';
  if (/advance|multiple.?draw/.test(q))
    return 'Advance Play: up to 39 consecutive Powerball drawings. Not available with Jackpot Combo.';
  if (/jackpot.?combo|combo.?jackpot/.test(q))
    return 'Jackpot Combo ($9): a bundle of one Florida Lotto ($2), one Powerball ($2), and one Mega Millions ($5) Quick Pick ticket. No add-ons or Advance Play available with Jackpot Combo.';
  return 'I can answer questions about Powerball prizes, odds, Power Play, Double Play, taxes, and draw schedule.\n\nTry asking:\n- "What are the jackpot odds?"\n- "What do I win for 4 of 5 + Powerball?"\n- "How does Power Play work?"\n- "Take-home on $1,000,000"\n- "When is the next drawing?"';
}

app.get('/nextdraw/powerball', (req, res) => res.json(getNextDrawPowerball()));

app.get('/analyze/powerball', async (req, res) => {
  try {
    await ensureDailyRefreshPB();
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    res.json(await runAnalysisPowerball(count, sid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/refresh/powerball', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => {
    lastAutoRefreshPB = null; pbDrawsCache = null; return appendPbDeltas();
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'powerball' });
});

app.post('/check/powerball', (req, res) => {
  const { drawn, powerballDrawn, line, powerballPlayed, powerPlay } = req.body;
  if (!Array.isArray(drawn) || drawn.length !== 5 || !Array.isArray(line) || line.length !== 5)
    return res.status(400).json({ error: 'Provide drawn (5 numbers) and line (5 numbers).' });
  const pb = parseInt(powerballDrawn);
  const pbP = parseInt(powerballPlayed);
  if (isNaN(pb) || pb < 1 || pb > 26) return res.status(400).json({ error: 'powerballDrawn must be 1-26.' });
  if (isNaN(pbP) || pbP < 1 || pbP > 26) return res.status(400).json({ error: 'powerballPlayed must be 1-26.' });
  const VALID_PP = [2, 3, 4, 5, 10];
  const pp = VALID_PP.includes(parseInt(powerPlay)) ? parseInt(powerPlay) : 0;
  const drawnSet = new Set(drawn.map(Number));
  const nums = line.map(Number);
  const matched = nums.filter(n => drawnSet.has(n));
  const wCount = matched.length;
  const pbMatch = pbP === pb;
  const BASE = {
    '5+1': 'JACKPOT', '5+0': 1000000,
    '4+1': 50000,    '4+0': 100,
    '3+1': 100,      '3+0': 7,
    '2+1': 7,        '1+1': 4,
    '0+1': 4,        '0+0': 0
  };
  const tier = wCount + (pbMatch ? '+1' : '+0');
  const raw = BASE[tier] || 0;
  let prize = 0, prizeDisplay, isJackpot = false;
  if (raw === 'JACKPOT') { isJackpot = true; prizeDisplay = 'JACKPOT'; }
  else if (raw > 0) {
    if (pp > 0 && !isJackpot) {
      prize = (wCount === 5 && !pbMatch) ? 2000000 : raw * pp;
    } else { prize = raw; }
    prizeDisplay = '$' + prize.toLocaleString() + (pp > 0 && !isJackpot ? ' (' + pp + 'x Power Play)' : '');
  } else { prizeDisplay = 'No prize'; }
  const wh = prize > 5000 ? Math.round(prize * 0.24) : 0;
  res.json({ drawn: drawn.map(Number), powerballDrawn: pb, line: nums, powerballPlayed: pbP, matched, whiteCount: wCount, pbMatch, tier, prize, prizeDisplay, isJackpot, powerPlay: pp, withholding: wh, takeHome: prize - wh });
});

app.get('/latestdraw/powerball', (req, res) => {
  try {
    const draws = getPbDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers, powerball: d.powerball });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/draws/powerball', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!isValidDrawDay(date, [1, 3, 6])) return res.status(404).json({ error: 'No Powerball draw on that date (draws Mon/Wed/Sat).', resultsUrl: 'https://www.floridalottery.com/games/draw-games/powerball' });
  try {
    const draws = getPbDraws();
    const pdfDate = normDateForPDF(date);
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers, powerball: match.powerball });
  } catch(e) {}
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: 'https://www.floridalottery.com/games/draw-games/powerball' });
});

app.get('/draws/powerball/available', (req, res) => {
  try {
    const draws = getPbDraws();
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===1||day===3||day===6; });
    const dates = filtered.slice(0, 5).map(d => expandYear(d.date));
    // Stale check: find most recent Mon(1)/Wed(3)/Sat(6) that has passed 10:59 PM ET
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const drawCutoff = new Date(nowET); drawCutoff.setHours(22, 59, 0, 0);
    let check = new Date(nowET);
    for (let i = 0; i < 7; i++) {
      const d = check.getDay();
      if ([1, 3, 6].includes(d) && (i > 0 || nowET >= drawCutoff)) {
        const mo = String(check.getMonth() + 1).padStart(2, '0');
        const dy = String(check.getDate()).padStart(2, '0');
        const missingDate = mo + '/' + dy + '/' + check.getFullYear();
        if (!dates.includes(missingDate)) dates.unshift(missingDate);
        break;
      }
      check.setDate(check.getDate() - 1);
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});

app.post('/chat/powerball', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyPowerball(message, context) });
});

// ── Mega Millions ───────────────────────────────────────────────────────────
// 5 white balls 1-70 + 1 Mega Ball 1-25. Draws Tue/Fri ~11:00 PM ET.
// PDF rows: M/D/YY  N N N N N  MB  N  [X#]  (2-digit years, optional Megaplier)

function parseMmHistoryPDF(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+MB\s+(\d{1,2})(?:\s+X\d+)?[\s\r\n]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (!nums || nums.length < 5) continue;
    const white = nums.slice(0, 5).map(Number).filter(n => n >= 1 && n <= 70);
    const mb = parseInt(m[3]);
    if (white.length !== 5 || mb < 1 || mb > 25) continue;
    const parts = date.split('/');
    let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
    const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    if (ts > Date.now() || ts < new Date('2013-01-01').getTime()) continue;
    draws.push({ date, numbers: white, megaball: mb, ts });
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws.slice(0, 500);
}

function getMmDraws() {
  if (!mmDrawsCache) mmDrawsCache = JSON.parse(fs.readFileSync(MM_DRAWS_PATH, 'utf8'));
  return mmDrawsCache;
}

let mmLastPdfMtime = null;
async function appendMmDeltas() {
  let mtime;
  try { mtime = fs.statSync(PDF_PATH_MM).mtimeMs; } catch(e) { return; }
  if (mtime === mmLastPdfMtime) { console.log('MM: PDF unchanged, skipping delta.'); return; }
  const existing = getMmDraws();
  const newestTs = existing.length ? existing[0].ts : 0;
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
}

function getNextDrawMegaMillions() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const DRAW_DAYS = [2, 5]; // Tue=2, Fri=5
  const DRAW_H = 23, DRAW_M = 0, CLOSE_H = 22, CLOSE_M = 45;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const candidate = new Date(nowET);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 8; i++) {
    if (DRAW_DAYS.includes(candidate.getDay())) {
      candidate.setHours(DRAW_H, DRAW_M, 0, 0);
      if (candidate > nowET) break;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  const salesClose = new Date(candidate);
  salesClose.setHours(CLOSE_H, CLOSE_M, 0, 0);
  return {
    dayName: DAY_NAMES[candidate.getDay()],
    date: MON_NAMES[candidate.getMonth()] + ' ' + candidate.getDate() + ', ' + candidate.getFullYear(),
    drawTime: '11:00 PM ET', closeTime: '10:45 PM ET',
    salesOpen: nowET < salesClose, msUntilDraw: candidate - nowET
  };
}

function scoreMegaMillions(nums, freq, draws, totalDraws) {
  const numArrays = draws.map(d => d.numbers);
  let score = 0;
  const maxFreq = Math.max(...Object.values(freq));
  nums.forEach(n => { score += (freq[n] || 0) / maxFreq * 40; });
  const recent = numArrays.slice(0, 50);
  nums.forEach(n => {
    const lastIdx = recent.map((d, i) => d.includes(n) ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx !== undefined) score += (lastIdx / recent.length) * 20;
  });
  const pairCounts = {};
  numArrays.forEach(d => {
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) {
        const k = d[i] + '-' + d[j];
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
  });
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const k = Math.min(nums[i],nums[j]) + '-' + Math.max(nums[i],nums[j]);
      score += (pairCounts[k] || 0) / totalDraws * 15;
    }
  const low = nums.filter(n => n <= 35).length;
  score += (2 - Math.abs(low - 2)) * 5;
  const sorted = [...nums].sort((a, b) => a - b);
  score += Math.min((sorted[4] - sorted[0]) / 69, 1) * 10;
  return score;
}

function generateMmLines(freq, mbFreq, draws, count, seenLines) {
  const totalDraws = draws.length;
  const pool = Array.from({ length: 70 }, (_, i) => i + 1)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0)).slice(0, 40);
  const mbPool = Array.from({ length: 25 }, (_, i) => i + 1)
    .sort((a, b) => (mbFreq[b] || 0) - (mbFreq[a] || 0)).slice(0, 15);
  const candidateTarget = Math.max(5000, count * 100);
  const usedCombos = new Set();
  const candidates = [];
  for (let attempt = 0; attempt < candidateTarget; attempt++) {
    const candidate = [];
    const available = [...pool];
    while (candidate.length < 5) {
      const weights = available.map(n => (freq[n] || 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
      candidate.push(available[idx]);
      available.splice(idx, 1);
    }
    candidate.sort((a, b) => a - b);
    const mb = mbPool[Math.floor(Math.random() * mbPool.length)];
    const key = candidate.join(',') + '|' + mb;
    if (!usedCombos.has(key)) {
      usedCombos.add(key);
      const penalty = seenLines.has(key) ? 30 : 0;
      candidates.push({ nums: candidate, megaball: mb, score: scoreMegaMillions(candidate, freq, draws, totalDraws) - penalty });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const lines = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.some(l => l.nums.filter(n => c.nums.includes(n)).length > 3)) lines.push(c);
  }
  for (const c of candidates) {
    if (lines.length >= count) break;
    if (!lines.includes(c)) lines.push(c);
  }
  return lines.slice(0, count);
}

let lastAutoRefreshMM = null;
let autoRefreshMMPromise = null;

async function ensureDailyRefreshMM() {
  const today = todayET();
  if (lastAutoRefreshMM === today) return;
  if (autoRefreshMMPromise) return autoRefreshMMPromise;
  autoRefreshMMPromise = downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => {
    lastAutoRefreshMM = today;
    autoRefreshMMPromise = null;
    console.log('Auto-refreshed Mega Millions PDF for ' + today);
  }).catch(err => {
    autoRefreshMMPromise = null;
    console.warn('Mega Millions auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshMMPromise;
}

async function runAnalysisMegaMillions(count, sid) {
  const draws = getMmDraws();
  if (draws.length < 10) throw new Error('Only ' + draws.length + ' Mega Millions draws in cache.');
  const freq = {}, mbFreq = {};
  draws.forEach(d => {
    d.numbers.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    mbFreq[d.megaball] = (mbFreq[d.megaball] || 0) + 1;
  });
  const sess = sid ? getSession(sid) : { lines: new Set() };
  const lines = generateMmLines(freq, mbFreq, draws, count, sess.lines);
  lines.forEach(l => sess.lines.add(l.nums.join(',') + '|' + l.megaball));
  const freqStats = Object.entries(freq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  const mbFreqStats = Object.entries(mbFreq).map(([n, c]) => ({ number: parseInt(n), count: c })).sort((a, b) => b.count - a.count);
  return {
    totalDraws: draws.length, nextDraw: getNextDrawMegaMillions(),
    recentHistory: draws.slice(0, 10),
    lines: lines.map((l, i) => ({ line: i + 1, numbers: l.nums, megaball: l.megaball, score: Math.round(l.score * 10) / 10 })),
    topNumbers: freqStats.slice(0, 10), bottomNumbers: freqStats.slice(-10).reverse(),
    topMegaballs: mbFreqStats.slice(0, 5),
    lastUpdated: draws[0] ? draws[0].date : 'unknown'
  };
}

function chatReplyMegaMillions(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;
  if (FL_APP_RE.test(q)) return FL_APP_REPLY;
  const wl = tryWinLoss(q) || tryReturnPct(q) || tryContextualSpend(q, context);
  if (wl) return wl;
  const taxM = q.match(/(?:take.?home|after.?tax|net|lump.?sum|keep).{0,30}\$(\d[\d,]*)/i) ||
               q.match(/\$(\d[\d,]*).{0,30}(?:take.?home|after.?tax|net|lump.?sum|keep)/i) ||
               q.match(/(?:tax|take.?home|net|keep).{0,20}(\d[\d,]+)/i);
  if (taxM) {
    const raw = parseInt(taxM[1].replace(/,/g, ''));
    if (raw >= 1 && raw <= 2000000000) {
      const wh = raw > 5000 ? Math.round(raw * 0.24) : 0;
      const net = raw - wh;
      const ann = raw > 1000000 ? '\n- Annuity (30 yrs): ~$' + Math.round(raw / 30).toLocaleString() + '/yr before tax' : '';
      return 'Prize: $' + raw.toLocaleString() + ann +
        '\n- Federal withholding (24%): -$' + wh.toLocaleString() +
        '\n- Florida state tax: $0' +
        '\n- Estimated take-home: ~$' + net.toLocaleString() +
        '\n\nNote: Additional federal tax may be owed at filing (up to 37%). Consult a tax professional.';
    }
  }
  const matchM = q.match(/(\d).{0,10}(?:of|out of).{0,5}5.{0,20}(?:plus|\+|with|and).{0,10}mega.?ball/i) ||
                 q.match(/mega.?ball.{0,20}(\d).{0,10}(?:of|out of).{0,5}5/i);
  if (matchM) {
    const m = parseInt(matchM[1]);
    const prizes = { 5: 'Jackpot', 4: '$10,000', 3: '$200', 2: '$10', 1: '$4', 0: '$2' };
    if (m >= 0 && m <= 5) return m + ' of 5 + Mega Ball: ' + (prizes[m] || 'No prize') + '\n\nTip: ask "take-home on $10000" for exact math.';
  }
  const simpleM = q.match(/(\d).{0,10}(?:of|out of).{0,5}5(?!.*mega)/i);
  if (simpleM) {
    const m = parseInt(simpleM[1]);
    const prizes = { 5: '$1,000,000', 4: '$500', 3: '$10', 2: '$4', 1: 'No prize', 0: 'No prize' };
    if (m >= 0 && m <= 5) return m + ' of 5 (no Mega Ball): ' + (prizes[m] || 'No prize');
  }
  if (/megaplier/.test(q))
    return 'Megaplier (+$1) multiplies non-jackpot prizes by 2x, 3x, 4x, or 5x (10x only when jackpot is under $150M).\n\nException: Match 5 (no Mega Ball) is always boosted to $5,000,000 with any Megaplier.\n\nMegaplier does NOT apply to the jackpot.\n\nMegaplier odds: 5x is 1 in 21 | 4x is 1 in 7 | 3x is 1 in 3.5 | 2x is 1 in 1.67';
  if (/jackpot|prize|win|payout|how much|worth/.test(q))
    return 'Mega Millions prizes (per play):\n\n- 5 of 5 + MB (Jackpot): pari-mutuel, starts ~$20M\n- 5 of 5 (no MB): $1,000,000\n- 4 of 5 + MB: $10,000\n- 4 of 5: $500\n- 3 of 5 + MB: $200\n- 3 of 5: $10\n- 2 of 5 + MB: $10\n- 1 of 5 + MB: $4\n- 0 of 5 + MB: $2\n\nOverall odds: 1 in 24\n\nAdd Megaplier (+$1) to multiply non-jackpot prizes up to 5x (or 10x when jackpot under $150M).';
  if (/odd|chance|probabilit/.test(q))
    return 'Mega Millions odds (per play):\n\n- Jackpot (5+MB): 1 in 302,575,350\n- 5 of 5 (no MB): 1 in 12,607,306\n- 4 of 5 + MB: 1 in 931,001\n- 4 of 5: 1 in 38,792\n- 3 of 5 + MB: 1 in 14,547\n- 3 of 5: 1 in 606\n- 2 of 5 + MB: 1 in 693\n- 1 of 5 + MB: 1 in 89\n- 0 of 5 + MB: 1 in 37\n- Any prize: 1 in 24';
  if (/cost|price|how much|ticket.{0,10}cost|how much.{0,10}play|spend/.test(q))
    return 'Mega Millions ticket costs (estimated, subject to change):\n\n- Base play: $2 per play\n- Megaplier add-on: +$1 per play\n\nExamples:\n- 1 play base: $2\n- 1 play + Megaplier: $3\n- 6 plays base: $12\n- 6 plays + Megaplier: $18\n\nAlways confirm at your retailer.';
  if (/how.{0,10}play|rules|work|ticket/.test(q))
    return 'How to play Mega Millions:\n\n- Cost: $2 per play\n- Pick 5 numbers from 1-70 (white balls) + 1 Mega Ball from 1-25\n- Drawings: Tuesday & Friday at ~11:00 PM ET\n- Sales close at 10:45 PM ET on draw nights\n- Add Megaplier (+$1) to multiply non-jackpot prizes\n- Jackpot paid as 30-year annuity or cash lump sum (~60%)';
  if (/when|draw|schedul|time|day|tuesday|friday/.test(q))
    return 'Mega Millions drawing schedule:\n\n- Draw days: Tuesday & Friday\n- Draw time: ~11:00 PM Eastern Time\n- Sales close: 10:45 PM ET on draw nights\n- Tickets purchased after 10:45 PM go into the next drawing';
  if (/lump|cash|annuit|payment|option/.test(q))
    return 'Mega Millions jackpot payment options:\n\n- Annuity: 30 annual payments, increasing each year\n- Cash lump sum: ~60% of advertised jackpot, paid immediately\n- Must elect cash option within 60 days of the drawing\n- Both options subject to 24% federal withholding\n- Florida has NO state income tax';
  if (/cancel|void/.test(q))
    return 'Mega Millions tickets cannot be canceled once printed.';
  if (/claim|expir|collect|redeem/.test(q))
    return 'Mega Millions prize claim:\n\n- Prizes expire 180 days from the drawing date\n- Up to $599: claim at any Florida Lottery retailer\n- $600+: Florida Lottery district office or headquarters\n- Must elect lump sum within 60 days';
  if (/advance|multiple.?draw/.test(q))
    return 'Advance Play: up to 26 consecutive Mega Millions drawings.';
  if (/jackpot.?combo|combo.?jackpot/.test(q))
    return 'Jackpot Combo ($9): a bundle of one Florida Lotto ($2), one Powerball ($2), and one Mega Millions ($5) Quick Pick ticket. No add-ons or Advance Play available with Jackpot Combo.';
  return 'I can answer questions about Mega Millions prizes, odds, Megaplier, taxes, and draw schedule.\n\nTry asking:\n- "What are the jackpot odds?"\n- "What do I win for 4 of 5 + Mega Ball?"\n- "How does Megaplier work?"\n- "Take-home on $1,000,000"\n- "When is the next drawing?"';
}

app.get('/nextdraw/megamillions', (req, res) => res.json(getNextDrawMegaMillions()));

app.get('/analyze/megamillions', async (req, res) => {
  try {
    await ensureDailyRefreshMM();
    const count = Math.min(Math.max(parseInt(req.query.count) || 6, 1), 100);
    const sid = req.query.sid || null;
    res.json(await runAnalysisMegaMillions(count, sid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/refresh/megamillions', (req, res) => {
  const sid = req.body && req.body.sid ? req.body.sid : null;
  enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => {
    lastAutoRefreshMM = null; mmDrawsCache = null; return appendMmDeltas();
  }));
  clearSession(sid);
  res.json({ queued: true, game: 'megamillions' });
});

app.post('/check/megamillions', (req, res) => {
  const { drawn, megaballDrawn, line, megaballPlayed, megaplier } = req.body;
  if (!Array.isArray(drawn) || drawn.length !== 5 || !Array.isArray(line) || line.length !== 5)
    return res.status(400).json({ error: 'Provide drawn (5 numbers) and line (5 numbers).' });
  const mb = parseInt(megaballDrawn);
  const mbP = parseInt(megaballPlayed);
  if (isNaN(mb) || mb < 1 || mb > 25) return res.status(400).json({ error: 'megaballDrawn must be 1-25.' });
  if (isNaN(mbP) || mbP < 1 || mbP > 25) return res.status(400).json({ error: 'megaballPlayed must be 1-25.' });
  const VALID_MP = [2, 3, 4, 5, 10];
  const mp = VALID_MP.includes(parseInt(megaplier)) ? parseInt(megaplier) : 0;
  const drawnSet = new Set(drawn.map(Number));
  const nums = line.map(Number);
  const matched = nums.filter(n => drawnSet.has(n));
  const wCount = matched.length;
  const mbMatch = mbP === mb;
  const BASE = {
    '5+1': 'JACKPOT', '5+0': 1000000,
    '4+1': 10000,    '4+0': 500,
    '3+1': 200,      '3+0': 10,
    '2+1': 10,       '1+1': 4,
    '0+1': 2,        '0+0': 0
  };
  const tier = wCount + (mbMatch ? '+1' : '+0');
  const raw = BASE[tier] || 0;
  let prize = 0, prizeDisplay, isJackpot = false;
  if (raw === 'JACKPOT') { isJackpot = true; prizeDisplay = 'JACKPOT'; }
  else if (raw > 0) {
    if (mp > 0) {
      prize = (wCount === 5 && !mbMatch) ? 5000000 : raw * mp;
    } else { prize = raw; }
    prizeDisplay = '$' + prize.toLocaleString() + (mp > 0 ? ' (' + mp + 'x Megaplier)' : '');
  } else { prizeDisplay = 'No prize'; }
  const wh = prize > 5000 ? Math.round(prize * 0.24) : 0;
  res.json({ drawn: drawn.map(Number), megaballDrawn: mb, line: nums, megaballPlayed: mbP, matched, whiteCount: wCount, mbMatch, tier, prize, prizeDisplay, isJackpot, megaplier: mp, withholding: wh, takeHome: prize - wh });
});

app.get('/latestdraw/megamillions', (req, res) => {
  try {
    const draws = getMmDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers, megaball: d.megaball });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/draws/megamillions', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!isValidDrawDay(date, [2, 5])) return res.status(404).json({ error: 'No Mega Millions draw on that date (draws Tue & Fri).', resultsUrl: 'https://www.floridalottery.com/games/draw-games/mega-millions' });
  try {
    const draws = getMmDraws();
    const pdfDate = normDateForPDF(date);
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers, megaball: match.megaball });
  } catch(e) {}
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: 'https://www.floridalottery.com/games/draw-games/mega-millions' });
});

app.get('/draws/megamillions/available', (req, res) => {
  try {
    const draws = getMmDraws();
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===2||day===5; });
    const dates = filtered.slice(0, 5).map(d => expandYear(d.date));
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const drawCutoff = new Date(nowET); drawCutoff.setHours(23, 0, 0, 0);
    let check = new Date(nowET);
    for (let i = 0; i < 7; i++) {
      const d = check.getDay();
      if ((d === 2 || d === 5) && (i > 0 || nowET >= drawCutoff)) {
        const mo = String(check.getMonth() + 1).padStart(2, '0');
        const dy = String(check.getDate()).padStart(2, '0');
        const missingDate = mo + '/' + dy + '/' + check.getFullYear();
        if (!dates.includes(missingDate)) dates.unshift(missingDate);
        break;
      }
      check.setDate(check.getDate() - 1);
    }
    res.json({ dates: dates.slice(0, 5) });
  } catch(e) { res.json({ dates: [] }); }
});

app.post('/chat/megamillions', (req, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message provided.' });
  res.json({ reply: chatReplyMegaMillions(message, context) });
});

function schedulePostDrawRefreshes() {
  const f5Times  = [[13, 10], [23, 20]];
  const pickTimes = [[13, 10], [23, 20]];
  const cpTimes  = [[7, 34], [11, 34], [14, 34], [18, 34], [22, 34]];
  const jtpDays  = [2, 5];
  const lxDays   = [3, 6];
  const pbDays   = [1, 3, 6]; // Mon=1, Wed=3, Sat=6
  const mmDays   = [2, 5]; // Tue=2, Fri=5

  f5Times.forEach(([h, m]) => scheduleDaily(h, m, () => {
    enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Post-draw refresh queued: Fantasy 5');
  }));

  pickTimes.forEach(([h, m]) => scheduleDaily(h, m, () => {
    Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {
      enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; pickDrawsCache[g] = null; }).then(() => appendPickDeltas(g)).catch(() => {}));
    });
    console.log('Post-draw refresh queued: Pick 2-5');
  }));

  cpTimes.forEach(([h, m]) => scheduleDaily(h, m, () => {
    enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => { lastAutoRefreshCP = null; }));
    console.log('Post-draw refresh queued: Cash Pop');
  }));

  scheduleDaily(23, 20, () => {
    const day = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    if (jtpDays.includes(day)) {
      enqueueRefresh('jtp', () => downloadPDFs().then(() => { lastAutoRefreshDate = null; jtpDrawsCache = null; }).then(() => appendJtpDeltas()).catch(() => {}));
      console.log('Post-draw refresh queued: JTP');
    }
    if (lxDays.includes(day)) {
      enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { lastAutoRefreshLottoX = null; return appendLottoXDeltas(); }));
      console.log('Post-draw refresh queued: Lotto X');
    }
    if (pbDays.includes(day)) {
      enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => { lastAutoRefreshPB = null; pbDrawsCache = null; }).then(() => appendPbDeltas()).catch(() => {}));
      console.log('Post-draw refresh queued: Powerball');
    }
    if (mmDays.includes(day)) {
      enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => { lastAutoRefreshMM = null; mmDrawsCache = null; }).then(() => appendMmDeltas()).catch(() => {}));
      console.log('Post-draw refresh queued: Mega Millions');
    }
    const jackpotGames = [];
    if (jtpDays.includes(day)) jackpotGames.push('jtp');
    if (lxDays.includes(day)) jackpotGames.push('lottox');
    if (pbDays.includes(day)) jackpotGames.push('powerball');
    if (mmDays.includes(day)) jackpotGames.push('megamillions');
    jackpotGames.forEach(g => {
      delete _jackpotCache[g];
      _scrapeGlobalLock = _scrapeGlobalLock.then(() => forceRefreshJackpot(g)).catch(() => {});
    });
  });

  // Retry at 13:25 ET for midday draws (Fantasy 5 Midday + Pick Midday at 1:05 PM)
  scheduleDaily(13, 25, () => {
    enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Post-draw midday retry queued: Fantasy 5');
    Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {
      enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; pickDrawsCache[g] = null; }).then(() => appendPickDeltas(g)).catch(() => {}));
    });
    console.log('Post-draw midday retry queued: Pick 2-5');
  });

  // Retry at 23:35 ET for evening draws (Fantasy 5 Evening + Pick Evening + JTP + LX + PB)
  scheduleDaily(23, 35, () => {
    const day = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    // Fantasy 5 + Pick retry every day
    enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Post-draw evening retry queued: Fantasy 5');
    Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {
      enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; pickDrawsCache[g] = null; }).then(() => appendPickDeltas(g)).catch(() => {}));
    });
    console.log('Post-draw evening retry queued: Pick 2-5');
    // JTP + LX + PB only on their draw days
    if (jtpDays.includes(day)) {
      enqueueRefresh('jtp', () => downloadPDFs().then(() => { lastAutoRefreshDate = null; jtpDrawsCache = null; }).then(() => appendJtpDeltas()).catch(() => {}));
      console.log('Post-draw retry queued: JTP');
    }
    if (lxDays.includes(day)) {
      enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { lastAutoRefreshLottoX = null; return appendLottoXDeltas(); }));
      console.log('Post-draw retry queued: Lotto X');
    }
    if (pbDays.includes(day)) {
      enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => { lastAutoRefreshPB = null; pbDrawsCache = null; }).then(() => appendPbDeltas()).catch(() => {}));
      console.log('Post-draw retry queued: Powerball');
    }
    if (mmDays.includes(day)) {
      enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => { lastAutoRefreshMM = null; mmDrawsCache = null; }).then(() => appendMmDeltas()).catch(() => {}));
      console.log('Post-draw retry queued: Mega Millions');
    }
  });

  // Cash Pop retries 15 min after each session
  [[7, 49], [11, 49], [14, 49], [18, 49], [22, 49]].forEach(([h, m]) => scheduleDaily(h, m, () => {
    enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => { lastAutoRefreshCP = null; }));
    console.log('Post-draw Cash Pop retry queued');
  }));

  // Midnight retry at 00:05 ET for all evening games — catches very slow PDF updates
  scheduleDaily(0, 5, () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yDay = yesterday.getDay();
    // Fantasy 5 + Pick draw every day
    enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; return appendFantasy5Deltas(); }));
    console.log('Midnight retry queued: Fantasy 5');
    Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {
      enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; pickDrawsCache[g] = null; }).then(() => appendPickDeltas(g)).catch(() => {}));
    });
    console.log('Midnight retry queued: Pick 2-5');
    // JTP + LX + PB only if yesterday was their draw day
    if (jtpDays.includes(yDay)) {
      enqueueRefresh('jtp', () => downloadPDFs().then(() => { lastAutoRefreshDate = null; jtpDrawsCache = null; }).then(() => appendJtpDeltas()).catch(() => {}));
      console.log('Midnight retry queued: JTP');
    }
    if (lxDays.includes(yDay)) {
      enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { lastAutoRefreshLottoX = null; return appendLottoXDeltas(); }));
      console.log('Midnight retry queued: Lotto X');
    }
    if (pbDays.includes(yDay)) {
      enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => { lastAutoRefreshPB = null; pbDrawsCache = null; }).then(() => appendPbDeltas()).catch(() => {}));
      console.log('Midnight retry queued: Powerball');
    }
    if (mmDays.includes(yDay)) {
      enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => { lastAutoRefreshMM = null; mmDrawsCache = null; }).then(() => appendMmDeltas()).catch(() => {}));
      console.log('Midnight retry queued: Mega Millions');
    }
  });

  f5Times.forEach(([h, m]) => scheduleDaily(h, m, () => {
    delete _jackpotCache['fantasy5'];
    _scrapeGlobalLock = _scrapeGlobalLock.then(() => forceRefreshJackpot('fantasy5')).catch(() => {});
  }));
}

schedulePostDrawRefreshes();

// ── Log rotation (local only — trim PM2 log files > 1 MB every 24h) ────────────────
function rotateLogs() {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) return;
  const MAX = 1 * 1024 * 1024; // 1 MB
  for (const f of ['combined.log', 'out.log', 'error.log']) {
    const p = path.join(logDir, f);
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > MAX) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        fs.writeFileSync(p, lines.slice(-500).join('\n'));
        console.log('Rotated ' + f + ' (kept last 500 lines)');
      }
    } catch (e) {}
  }
}
rotateLogs();
setInterval(rotateLogs, 24 * 60 * 60 * 1000);

start().catch(err => { console.error(err); process.exit(1); });
