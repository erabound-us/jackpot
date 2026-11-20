const fs = require('fs');
let c = fs.readFileSync('c:/Jackpot/server.js', 'utf8');

// Find and replace each latestdraw route with a clean JSON-only version

// ── LX ──
const lxStart = c.indexOf("app.get('/latestdraw/lottox'");
const lxEnd = c.indexOf("\napp.get('/latestdraw/fantasy5'");
const lxOld = c.substring(lxStart, lxEnd);
const lxNew = `app.get('/latestdraw/lottox', async (req, res) => {
  try {
    const draws = getLottoXDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
`;
process.stdout.write('LX old length: ' + lxOld.length + '\n');
c = c.substring(0, lxStart) + lxNew + c.substring(lxEnd);

// ── F5 ──
const f5Start = c.indexOf("app.get('/latestdraw/fantasy5'");
const f5End = c.indexOf("\napp.get('/latestdraw/cashpop'");
const f5Old = c.substring(f5Start, f5End);
const f5New = `app.get('/latestdraw/fantasy5', async (req, res) => {
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
`;
process.stdout.write('F5 old length: ' + f5Old.length + '\n');
c = c.substring(0, f5Start) + f5New + c.substring(f5End);

// ── CP ──
const cpStart = c.indexOf("app.get('/latestdraw/cashpop'");
const cpEnd = c.indexOf("\n\n\n// ── Jackpot cache");
const cpOld = c.substring(cpStart, cpEnd);
const cpNew = `app.get('/latestdraw/cashpop', async (req, res) => {
  try {
    const draws = getCpDraws();
    if (!draws.length) return res.status(404).json({ error: 'No draws found.' });
    const d = draws[0];
    res.json({ date: d.date, numbers: d.numbers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
`;
process.stdout.write('CP old length: ' + cpOld.length + '\n');
c = c.substring(0, cpStart) + cpNew + c.substring(cpEnd);

// ── Pick ── (uses getPickText/PDF - replace with JSON-like approach using cached text)
// Pick PDFs are small and use getPickText which serializes - keep as-is but verify it's safe
// Actually Pick latestdraw uses getPickText which is already serialized - leave it
process.stdout.write('Pick: leaving as-is (getPickText is serialized)\n');

fs.writeFileSync('c:/Jackpot/server.js', c, 'utf8');
process.stdout.write('done\n');
