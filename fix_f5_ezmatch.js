const fs = require('fs');

// ── index.html ────────────────────────────────────────────────────────────────
{
  const path = 'C:\\Jackpot\\public\\index.html';
  let src = fs.readFileSync(path, 'utf8');

  function sr(src, old, neu, label) {
    const idx = src.indexOf(old);
    if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
    console.log(label, 'fixed at idx', idx);
    return src.slice(0, idx) + neu + src.slice(idx + old.length);
  }

  // 1. Add EZMatch input above the Calculate Winnings button
  src = sr(src,
    `    <div id="f5LinesInputs"></div>
    <button class="action-btn primary" onclick="f5CheckNumbers()">Calculate Winnings</button>`,
    `    <div id="f5LinesInputs"></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">EZMatch won <span style="color:var(--accent);">($)</span></div>
        <input type="number" id="f5EZMatch" value="0" min="0" max="500" style="width:80px;text-align:center;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:8px;border-radius:8px;font-size:14px;font-weight:700;">
      </div>
    </div>
    <button class="action-btn primary" onclick="f5CheckNumbers()">Calculate Winnings</button>`,
    'HTML: EZMatch input'
  );

  // 2. Pass ezMatch in the fetch body
  src = sr(src,
    `body: JSON.stringify({ drawn: drawn, line: lineNums }), signal: _acF5C.signal })\n\n      .then(function(res) { return res.json(); })`,
    `body: JSON.stringify({ drawn: drawn, line: lineNums, ezMatch: lineIdx === 0 ? (parseInt(document.getElementById('f5EZMatch').value) || 0) : 0 }), signal: _acF5C.signal })\n\n      .then(function(res) { return res.json(); })`,
    'HTML: pass ezMatch in fetch'
  );

  // 3. Display EZMatch row in results (after the per-line result, same as LX)
  src = sr(src,
    `          html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '">';\n\n          html += '<span style="font-weight:700;">' + label + '</span> &mdash; ' + d.count + ' match' + (d.count !== 1 ? 'es' : '') + ' (' + matchedNums + ')';\n\n          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';`,
    `          html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '">';\n\n          html += '<span style="font-weight:700;">' + label + '</span> &mdash; ' + d.count + ' match' + (d.count !== 1 ? 'es' : '') + ' (' + matchedNums + ')';\n\n          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';\n          if (idx === 0 && d.ezMatch > 0) html += '<div class="check-line-result winner" style="border-color:var(--green);"><span style="font-weight:700;">EZMatch</span> &mdash; <span style="color:var(--green);font-weight:700;">$' + d.ezMatch.toLocaleString() + '</span></div>';`,
    'HTML: display EZMatch row'
  );

  // 4. Include ezMatch in f5TotalWinAcc
  src = sr(src,
    `        f5TotalWinAcc += data.isFree ? 0 : (data.prize || 0);`,
    `        f5TotalWinAcc += data.isFree ? 0 : (data.prize || 0);
        f5TotalWinAcc += data.ezMatch || 0;`,
    'HTML: include ezMatch in total'
  );

  // 5. Clear f5EZMatch on reset
  src = sr(src,
    `function f5ClearCheck() {`,
    `function f5ClearCheck() {\n  document.getElementById('f5EZMatch').value = '0';`,
    'HTML: clear EZMatch on reset'
  );

  fs.writeFileSync(path, src, 'utf8');
  console.log('index.html done. Size:', fs.statSync(path).size);
}

// ── server.js ─────────────────────────────────────────────────────────────────
{
  const path = 'C:\\Jackpot\\server.js';
  let src = fs.readFileSync(path, 'utf8');

  function sr(src, old, neu, label) {
    const idx = src.indexOf(old);
    if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
    console.log(label, 'fixed at idx', idx);
    return src.slice(0, idx) + neu + src.slice(idx + old.length);
  }

  // Accept ezMatch, add to totalWin, include in response
  src = sr(src,
    `  const { drawn, line } = req.body;\n  if (!Array.isArray(drawn) || drawn.length !== 5 || !Array.isArray(line) || line.length !== 5)\n    return res.status(400).json({ error: 'Provide drawn (5 numbers) and line (5 numbers).' });`,
    `  const { drawn, line, ezMatch: ezMatchRaw } = req.body;\n  if (!Array.isArray(drawn) || drawn.length !== 5 || !Array.isArray(line) || line.length !== 5)\n    return res.status(400).json({ error: 'Provide drawn (5 numbers) and line (5 numbers).' });\n  const ezMatchWin = Math.min(Math.max(parseInt(ezMatchRaw) || 0, 0), 500);`,
    'server: accept ezMatch'
  );

  src = sr(src,
    `  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE' });`,
    `  const totalWin = prize + ezMatchWin;\n  res.json({ drawn: drawn.map(Number), line: nums, matched, count, prize, prizeDisplay, isJackpot: raw === 'JACKPOT', isFree: raw === 'FREE', ezMatch: ezMatchWin, totalWin });`,
    'server: include ezMatch in response'
  );

  const { execSync } = require('child_process');
  fs.writeFileSync(path, src, 'utf8');
  try {
    execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
    console.log('server.js syntax OK. Size:', fs.statSync(path).size);
  } catch(e) { console.log('Syntax error:', e.stdout.toString()); }
}
