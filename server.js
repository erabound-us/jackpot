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
  if (req.path.startsWith('/nextdraw') || req.path.startsWith('/latestdraw') || req.path === '/refresh/status' || req.path === '/health') return next();

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
  return draws;
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
  const histBuf = fs.readFileSync(PDF_PATHS.history);
  const freqBuf = fs.readFileSync(PDF_PATHS.frequency);
  const [histText, freqText] = await Promise.all([
    extractPDFText(histBuf),
    extractPDFText(freqBuf)
  ]);
  const draws = parseHistoryPDF(histText);
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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

function chatReply(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;

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

const PDF_URLS_LX = 'https://files.floridalottery.com/exptkt/lotto_winning-numbers-history.pdf';
const PDF_PATH_LX = path.join(__dirname, 'lotto_winning-numbers-history.pdf');

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
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+LOTTO\s+\d/g;
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
  return draws;
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

// mtime-based parse cache for PDFs > 1 MB -- never stale: invalidates when file changes on disk
let lxCache = null;
let lxParsePromise = null;

async function getLottoXText() {
  const mtime = fs.statSync(PDF_PATH_LX).mtimeMs;
  if (lxCache && lxCache.mtime === mtime) return lxCache.text;
  if (!lxParsePromise) {
    lxParsePromise = extractPDFText(fs.readFileSync(PDF_PATH_LX)).then(text => {
      lxCache = { text, mtime };
      lxParsePromise = null;
      console.log('Lotto X PDF cache refreshed (mtime changed)');
      return text;
    });
  }
  return lxParsePromise;
}

async function runAnalysisLottoX(count = 6, sid = null) {
  const text = await getLottoXText();
  const draws = parseLottoXHistoryPDF(text);
  if (draws.length < 10) throw new Error(`Only ${draws.length} Lotto X draws parsed.`);
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
    lastUpdated: fs.statSync(PDF_PATH_LX).mtime.toLocaleString()
  };
}

function chatReplyLottoX(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;

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
    lastAutoRefreshLottoX = null; lxCache = null;
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

  server.listen(port, '0.0.0.0', async () => {
    process.stdout.write('Downloading latest PDFs from Florida Lottery...');
    const dl = await downloadPDFs();
    const failed = Object.entries(dl).filter(([, v]) => v !== 'ok');
    if (!failed.length) {
      console.log(' done.');
    } else {
      console.log('');
      failed.forEach(([k, v]) => console.warn(`  ⚠️  ${k}: ${v} (using cached file)`));
    }

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

const PDF_URL_CP  = 'https://files.floridalottery.com/exptkt/cash-pop_winning-numbers-history.pdf';
const PDF_PATH_CP = path.join(__dirname, 'cash-pop_winning-numbers-history.pdf');

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
  return draws;
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
  const buf = fs.readFileSync(PDF_PATH_CP);
  const text = await extractPDFText(buf);
  const draws = parseCashPopHistoryPDF(text);
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
  }));
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

const PDF_URL_F5  = 'https://files.floridalottery.com/exptkt/fantasy5_winning-numbers-history.pdf';
const PDF_PATH_F5 = path.join(__dirname, 'fantasy5_winning-numbers-history.pdf');

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
  return draws;
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

let f5Cache = null;
let f5ParsePromise = null;

async function getFantasy5Text() {
  const mtime = fs.statSync(PDF_PATH_F5).mtimeMs;
  if (f5Cache && f5Cache.mtime === mtime) return f5Cache.text;
  if (!f5ParsePromise) {
    f5ParsePromise = extractPDFText(fs.readFileSync(PDF_PATH_F5)).then(text => {
      f5Cache = { text, mtime };
      f5ParsePromise = null;
      console.log('Fantasy 5 PDF cache refreshed (mtime changed)');
      return text;
    });
  }
  return f5ParsePromise;
}

async function runAnalysisFantasy5(count = 6, sid = null) {
  const text = await getFantasy5Text();
  const draws = parseFantasy5HistoryPDF(text);
  if (draws.length < 10) throw new Error('Only ' + draws.length + ' Fantasy 5 draws parsed.');
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
    lastUpdated: fs.statSync(PDF_PATH_F5).mtime.toLocaleString()
  };
}

function chatReplyFantasy5(question, context) {
  const q = question.toLowerCase().trim();
  if (TZ_RE.test(q)) return TZ_REPLY;

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
    lastAutoRefreshF5 = null; f5Cache = null;
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
async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
  }
  return _browser;
}
async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch(_) {} _browser = null; }
}

async function scrapeFlDraws(game, dateStr, drawType) {
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
    const draws = parseHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATHS.history)));
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers });
  } catch (e) {}
  const scraped = await scrapeFlDraws('jtp', date, null);
  if (scraped) return res.json({ date, numbers: scraped.numbers });
  delete _availCache['jtp']; // invalidate chips cache so stale dates clear
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.jtp });
});

app.get('/draws/lottox', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  if (!isValidDrawDay(date, [3, 6])) return res.status(404).json({ error: 'No Lotto X draw on that date (draws Wed & Sat).', resultsUrl: FL_RESULTS_URLS.lottox });
  const pdfDate = normDateForPDF(date);
  try {
    const draws = parseLottoXHistoryPDF(await getLottoXText());
    const match = draws.find(d => stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date);
    if (match) return res.json({ date: match.date, numbers: match.numbers });
  } catch (e) {}
  const scraped = await scrapeFlDraws('lottox', date, null);
  if (scraped) return res.json({ date, numbers: scraped.numbers });
  delete _availCache['lottox']; // invalidate chips cache so stale dates clear
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.lottox });
});

app.get('/draws/fantasy5', async (req, res) => {
  const { date, draw } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  const type = (draw || '').toUpperCase();
  const pdfDate = normDateForPDF(date);
  try {
    const draws = parseFantasy5HistoryPDF(await getFantasy5Text());
    const match = draws.find(d => (stripLeadingZeros(d.date) === stripLeadingZeros(pdfDate) || d.date === pdfDate || d.date === date) && (!type || d.drawType === type));
    if (match) return res.json({ date: match.date, drawType: match.drawType, numbers: match.numbers });
  } catch (e) {}
  const scraped = await scrapeFlDraws('fantasy5', date, type);
  if (scraped) return res.json({ date, drawType: scraped.drawType || type, numbers: scraped.numbers });
  delete _availCache['fantasy5']; // invalidate chips cache so stale dates clear
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
    const draws = parseHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATHS.history)));
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===2||day===5; });
    res.json({ dates: filtered.slice(0, 5).map(d => expandYear(d.date)) });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/lottox/available', async (req, res) => {
  try {
    const draws = parseLottoXHistoryPDF(await getLottoXText());
    const filtered = draws.filter(d => { const p = d.date.split('/'); const day = new Date(Date.UTC(parseInt(p[2].length===2?'20'+p[2]:p[2]), parseInt(p[0])-1, parseInt(p[1]))).getUTCDay(); return day===3||day===6; });
    res.json({ dates: filtered.slice(0, 5).map(d => expandYear(d.date)) });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/fantasy5/available', async (req, res) => {
  try {
    const draws = parseFantasy5HistoryPDF(await getFantasy5Text());
    const now = Date.now();
    const valid = draws.filter(d => d.ts > new Date('2019-01-01').getTime() && d.ts <= now);
    const seen = new Set(); const dates = [];
    for (const d of valid) {
      const key = d.date; if (seen.has(key)) continue; seen.add(key);
      dates.push(expandYear(d.date));
      if (dates.length >= 5) break;
    }
    res.json({ dates });
  } catch(e) { res.json({ dates: [] }); }
});
app.get('/draws/cashpop/available', async (req, res) => {
  try {
    const draws = parseCashPopHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATH_CP)));
    res.json({ dates: draws.slice(0, 5).map(d => expandYear(d.date)) });
  } catch(e) { res.json({ dates: [] }); }
});

app.get('/draws/cashpop', async (req, res) => {
  const { date, session } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (MM/DD/YYYY)' });
  // PDF fallback first - has 5 numbers per date (one per session)
  try {
    const draws = parseCashPopHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATH_CP)));
    const pdfDate = normDateForPDF(date);
    const match = draws.find(d => d.date === date || d.date === pdfDate);
    if (match) {
      const sessions = ['Morning','Matinee','Afternoon','Evening','Late Night'];
      const allSessions = match.numbers.map((n, i) => ({ name: sessions[i], number: n }));
      const target = session ? allSessions.find(s => s.name.toLowerCase() === session.toLowerCase()) : allSessions[allSessions.length-1];
      if (target) return res.json({ date, session: target.name, number: target.number, allSessions });
    }
  } catch(e) {}
  const scraped = await scrapeFlDraws('cashpop', date, session || null);
  if (scraped && scraped.sessions && scraped.sessions.length) {
    const target = session ? scraped.sessions.find(s => s.name.toLowerCase() === session.toLowerCase()) : scraped.sessions[scraped.sessions.length-1];
    if (target) return res.json({ date, session: target.name, number: target.number, allSessions: scraped.sessions });
    // Session requested but not yet drawn
    return res.status(404).json({ error: 'That session has not drawn yet for this date.', allSessions: scraped.sessions, resultsUrl: FL_RESULTS_URLS.cashpop });
  }
  delete _availCache['cashpop'];
  res.status(404).json({ error: 'No draw found for that date.', resultsUrl: FL_RESULTS_URLS.cashpop });
});

app.get('/latestdraw/jtp', async (req, res) => {
  try {
    const draws = parseHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATHS.history)));
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/lottox', async (req, res) => {
  try {
    const draws = parseLottoXHistoryPDF(await getLottoXText());
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/fantasy5', async (req, res) => {
  try {
    const draws = parseFantasy5HistoryPDF(await getFantasy5Text());
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const now = Date.now();
    const valid = draws.filter(d => d.ts > new Date('2019-01-01').getTime() && d.ts <= now);
    const evening = valid.find(d => d.drawType === 'EVENING');
    const midday  = valid.find(d => d.drawType === 'MIDDAY');
    res.json({
      evening: evening ? { date: evening.date, numbers: evening.numbers } : null,
      midday:  midday  ? { date: midday.date,  numbers: midday.numbers  } : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/latestdraw/cashpop', async (req, res) => {
  try {
    const draws = parseCashPopHistoryPDF(await extractPDFText(fs.readFileSync(PDF_PATH_CP)));
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

function schedulePostDrawRefreshes() {
  const f5Times  = [[13, 10], [23, 20]];
  const cpTimes  = [[7, 34], [11, 34], [14, 34], [18, 34], [22, 34]];
  // JTP draws Tue(2) & Fri(5); Lotto X draws Wed(3) & Sat(6) — refresh 5 min after 11:15 PM ET
  const jtpDays  = [2, 5];
  const lxDays   = [3, 6];

  f5Times.forEach(([h, m]) => scheduleDaily(h, m, () => {
    enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => { lastAutoRefreshF5 = null; f5Cache = null; }));
    console.log('Post-draw refresh queued: Fantasy 5');
  }));

  cpTimes.forEach(([h, m]) => scheduleDaily(h, m, () => {
    enqueueRefresh('cashpop', () => downloadFile(PDF_URL_CP, PDF_PATH_CP).then(() => { lastAutoRefreshCP = null; }));
    console.log('Post-draw refresh queued: Cash Pop');
  }));

  scheduleDaily(23, 20, () => {
    const day = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    if (jtpDays.includes(day)) {
      enqueueRefresh('jtp', () => downloadPDFs().then(() => { lastAutoRefreshDate = null; }));
      console.log('Post-draw refresh queued: JTP');
    }
    if (lxDays.includes(day)) {
      enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { lastAutoRefreshLottoX = null; lxCache = null; }));
      console.log('Post-draw refresh queued: Lotto X');
    }
  });
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
