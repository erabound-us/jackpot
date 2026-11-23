
fetch('/mode').then(function(r){return r.json();}).then(function(m){
  if(m.local){
    document.getElementById('refreshBtn').style.display='';
    var pb=document.getElementById('portBadge');
    pb.style.display='';
    pb.textContent='Port '+location.port;
  } else {
    document.getElementById('emailSettingsCard').style.display='none';
  }
}).catch(function(){});
var SID = sessionStorage.getItem('jackpot_sid');
if (!SID) { SID = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); sessionStorage.setItem('jackpot_sid', SID); }
loadEmailConfig();
document.getElementById('chatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChat(); });

var statusMsg = document.getElementById('statusMsg');
var results = document.getElementById('results');
var generateBtn = document.getElementById('generateBtn');
var refreshBtn = document.getElementById('refreshBtn');
var pressHint = document.getElementById('pressHint');
var pressCount = 0;
var countdownInterval = null;

function setStatus(type, text) { statusMsg.className = 'status-msg ' + type; statusMsg.textContent = text; }
function clearStatus() { statusMsg.style.display = 'none'; }
function setAllBtns(disabled) { generateBtn.disabled = refreshBtn.disabled = disabled; }

function startCountdown(data) {
  var nd = data.nextDraw;
  document.getElementById('drawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('drawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('closeTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  var salesBadge = document.getElementById('salesBadge');
  var banner = document.getElementById('drawBanner');
  salesBadge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  salesBadge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (countdownInterval) clearInterval(countdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('countdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('countdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function renderLines(lines) {
  var container = document.getElementById('linesContainer');
  var existing = container.querySelectorAll('.line-card');
  for (var i = 0; i < existing.length; i++) existing[i].classList.add('fading');
  lastLines = lines;
  document.getElementById('emailCard').style.display = 'block';
  setTimeout(function() {
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var balls = '';
      for (var j = 0; j < l.numbers.length; j++) balls += '<div class="ball">' + l.numbers[j] + '</div>';
      html += '<div class="line-card' + (i === 0 ? ' best' : '') + '"><div class="line-label">' + (i === 0 ? 'Best' : 'Line ' + l.line) + '</div><div class="balls">' + balls + '</div><div class="score-wrap"><div class="score-label">' + l.score + '</div><div class="score-info" title="What is this score?">?<div class="score-tooltip"><strong>What is this score?</strong>Higher = statistically stronger line. Scored on: frequency of each number in all past draws (40 pts), how recently each number appeared (20 pts), how often pairs of numbers appeared together (15 pts), low/high balance (5 pts), and spread across the 1–46 range (10 pts). Higher-scored lines are ranked first. It does NOT predict winners — lottery draws are random.</div></div></div></div>';
    }
    container.innerHTML = html;
  }, 150);
}

function renderHistory(history) {
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = '';
    for (var j = 0; j < d.numbers.length; j++) balls += '<div class="hball">' + d.numbers[j] + '</div>';
    html += '<div class="history-row"><div class="history-date">' + d.date + '</div><div class="history-balls">' + balls + '</div></div>';
  }
  document.getElementById('historyContainer').innerHTML = html;
}

function renderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('topTable').innerHTML = rows(top);
  document.getElementById('bottomTable').innerHTML = rows(bottom);
}

var lastLines = null;
var lastNextDraw = null;
var jtpLastWin = null;
var jtpLatestDate = null;
var jtpDrawn = [];

// Populate draw banner on page load without requiring Generate
fetch('/nextdraw')
  .then(function(r) { return r.json(); })
  .then(function(d) { startCountdown({ nextDraw: d }); })
  .catch(function() {});

function renderAll(data) {
  startCountdown(data);
  lastNextDraw = data.nextDraw;
  document.getElementById('drawsBadge').textContent = data.totalDraws + ' draws analyzed';
  document.getElementById('updatedLabel').textContent = 'Data as of: ' + data.lastUpdated;
  renderHistory(data.recentHistory);
  renderFreq(data.topNumbers, data.bottomNumbers);
  results.classList.add('show');
}

function generate() {
  setAllBtns(true);
  generateBtn.textContent = 'Generating...';
  clearStatus();
  var count = Math.min(Math.max(parseInt(document.getElementById('lineCount').value) || 6, 1), 100);
  var _ac0 = new AbortController(); setTimeout(function(){_ac0.abort();}, 30000);
  fetch('/analyze?count=' + count + '&sid=' + SID, {signal:_ac0.signal})
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      pressCount++;
      document.getElementById('pressNum').textContent = pressCount;
      pressHint.style.display = 'block';
      document.getElementById('jtpEmailBlurb').style.display = 'block';
      if (pressCount === 1) renderAll(r.data);
      else startCountdown(r.data);
      renderLines(r.data.lines);
      clearStatus();
    })
    .catch(function(err) { setStatus('error', 'Error: ' + err.message); })
    .finally(function() { setAllBtns(false); generateBtn.textContent = '\u{1F3B1} Generate Lines'; });
}

function doReset() {
  setAllBtns(true);
  fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: SID }) }).catch(function() {}).finally(function() {
    pressCount = 0;
    pressHint.style.display = 'none';
    document.getElementById('jtpEmailBlurb').style.display = 'none';
    results.classList.remove('show');
    document.getElementById('emailCard').style.display = 'none';
    document.getElementById('emailStatus').textContent = '';
    lastLines = null;
    jtpLastWin = null;
    document.getElementById('linesContainer').innerHTML = '';
    document.getElementById('historyContainer').innerHTML = '';
    document.getElementById('topTable').innerHTML = '';
    document.getElementById('bottomTable').innerHTML = '';
    document.getElementById('drawsBadge').textContent = '';
    document.getElementById('updatedLabel').textContent = '';
    clearStatus();
    setAllBtns(false);
  });
}

function doRefresh() {
  setAllBtns(true);
  document.getElementById('refreshSpin').classList.add('spinning');
  setStatus('loading', 'Downloading latest PDFs from Florida Lottery...');
  results.classList.remove('show');
  pressCount = 0;
  pressHint.style.display = 'none';
  var _acR = new AbortController(); setTimeout(function(){_acR.abort();}, 10000);
  fetch('/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: SID }), signal: _acR.signal })
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Download failed');
      pressCount = 1;
      document.getElementById('pressNum').textContent = pressCount;
      pressHint.style.display = 'block';
      document.getElementById('jtpEmailBlurb').style.display = 'block';
      renderAll(r.data);
      renderLines(r.data.lines);
      clearStatus();
    })
    .catch(function(err) { setStatus('error', 'Error: ' + err.message); })
    .finally(function() { setAllBtns(false); document.getElementById('refreshSpin').classList.remove('spinning'); });
}

function jtpRebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('jtpCheckLineCount').value) || 3, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="lineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2"><input class="num-input" placeholder="#6" maxlength="2"></div></div>';
  }
  document.getElementById('myLinesInputs').innerHTML = html;
}
jtpRebuildCheckLines();

function jtpLookupDraw() {
  var dateVal = document.getElementById('jtpDrawDate').value;
  var msg = document.getElementById('jtpDrawLookupMsg');
  var display = document.getElementById('jtpDrawnDisplay');
  jtpDrawn = [];
  display.style.display = 'none';
  document.getElementById('jtpDrawnBalls').innerHTML = '';
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Looking up...';
  var _jtpDate = dateVal;
  if (window._jtpLookupAC) window._jtpLookupAC.abort('new-lookup');
  window._jtpLookupAC = new AbortController(); setTimeout(function(){if(window._jtpLookupAC)window._jtpLookupAC.abort('timeout');},60000);
  (function(){return fetch('/draws/jtp?date=' + encodeURIComponent(mmddyy),{signal:window._jtpLookupAC.signal});})()
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (document.getElementById('jtpDrawDate').value !== _jtpDate) return;
      if (data.error) {
        msg.style.color = 'var(--red)';
        msg.textContent = data.error;
        if (data.resultsUrl) {
          msg.innerHTML = data.error + ' <a href="' + data.resultsUrl + '" target="_blank" style="color:var(--accent);">View official results</a>';
        }
        return;
      }
      jtpDrawn = data.numbers;
      msg.textContent = '';
      display.style.display = 'block';
            var jtpIsLatest = jtpLatestDate && document.getElementById('jtpDrawDate').value === jtpLatestDate;
      var jtpBallStyle = jtpIsLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
      document.getElementById('jtpDrawnBalls').innerHTML = data.numbers.map(function(n) {
        return '<div class="hball" style="' + jtpBallStyle + ';width:36px;height:36px;font-size:13px;">' + n + '</div>';
      }).join('');
    })
    .catch(function(e) { if (e && e.name === 'AbortError') { msg.textContent = ''; return; } msg.style.color = 'var(--red)'; msg.textContent = 'Lookup failed.'; });
}

function checkNumbers() {
  if (!jtpDrawn.length) {
    document.getElementById('checkResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>';
    return;
  }
  var drawn = jtpDrawn;
  var lines = [];
  var lineCount = document.querySelectorAll('#myLinesInputs .line-input-row').length;
  for (var r = 0; r < lineCount; r++) {
    var row = document.querySelectorAll('#lineRow' + r + ' .num-input');
    var line = [];
    for (var j = 0; j < row.length; j++) {
      var lv = parseInt(row[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 46) {
        document.getElementById('checkResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Please enter all 6 numbers for Line ' + (r+1) + ' (1-46).</div>';
        return;
      }
      line.push(lv);
    }
    lines.push(line);
  }
  var hasCombo = document.getElementById('comboCheck').checked;
  var drawnSet = {};
  drawn.forEach(function(n) { drawnSet[n] = true; });
  for (var r = 0; r < lineCount; r++) {
    var row = document.querySelectorAll('#lineRow' + r + ' .num-input');
    for (var j = 0; j < row.length; j++) {
      var hv = parseInt(row[j].value);
      row[j].className = 'num-input' + (drawnSet[hv] ? ' matched' : '');
    }
  }
  var _acC = new AbortController(); setTimeout(function(){_acC.abort();}, 15000);
  fetch('/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drawn: drawn, lines: lines }), signal: _acC.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { document.getElementById('checkResult').innerHTML = '<div style="color:var(--red);">' + data.error + '</div>'; return; }
      var html = '';
      if (data.jackpotLines > 0) {
        var lineWord = data.jackpotLines > 1 ? 'lines' : 'line';
        var note = 'You own all ' + data.jackpotLines + ' winning ' + lineWord + ' on this ticket, so you collect 100% of the jackpot pool. Your payout is only reduced if another player also matched 6 of 6.';
        html += '<div style="font-size:12px;color:var(--yellow);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:8px 10px;margin-bottom:8px;">' + note + '</div>';
      }
      for (var i = 0; i < data.lineResults.length; i++) {
        var l = data.lineResults[i];
        var isWinner = typeof l.prize === 'number' && l.prize > 0;
        var matchedNums = l.matched.join(', ') || 'none';
        var prizeLabel;
        if (l.isJackpot) {
          prizeLabel = 'approx $' + l.prize.toLocaleString() + ' (jackpot pool)';
        } else if (l.prize > 0) {
          prizeLabel = 'approx $' + l.prize.toLocaleString();
        } else {
          prizeLabel = 'No prize';
        }
        html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '"><span style="font-weight:700;">Line ' + l.line + '</span> &mdash; ' + l.count + ' match' + (l.count !== 1 ? 'es' : '') + ' (' + matchedNums + ') &mdash; <span style="color:' + (isWinner ? 'var(--green)' : 'var(--muted)') + ';font-weight:700;">' + prizeLabel + '</span></div>';
      }
      if (hasCombo) {
        var comboLabel = data.comboPrize === 'FREE' ? 'Free $2 Combo Quick Pick' : (data.comboPrize > 0 ? '$' + data.comboPrize.toLocaleString() : 'No prize');
        var comboWinner = data.comboPrize > 0 || data.comboPrize === 'FREE';
        html += '<div class="check-line-result' + (comboWinner ? ' winner' : '') + '" style="margin-top:8px;border-color:var(--accent);"><span style="font-weight:700;">Combo</span> &mdash; ' + data.comboTotal + ' total matches across all 3 lines &mdash; <span style="color:' + (comboWinner ? 'var(--accent)' : 'var(--muted)') + ';font-weight:700;">' + comboLabel + '</span></div>';
      }
      var totalWin = data.basePrizeTotal + (hasCombo && typeof data.comboPrize === 'number' ? data.comboPrize : 0);
      jtpLastWin = totalWin;
      var totalLabel = totalWin > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
      var totalDisplay = totalWin > 0 ? 'approx $' + totalWin.toLocaleString() : '$0';
      html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount">' + totalDisplay + '</div>' + (hasCombo ? '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Base game + Combo combined</div>' : '') + '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Jackpot assumes no other winners. Base prizes are pari-mutuel estimates.</div></div>';
      document.getElementById('checkResult').innerHTML = html;
    })
    .catch(function(err) { document.getElementById('checkResult').innerHTML = '<div style="color:var(--red);">Error: ' + err.message + '</div>'; });
}

function clearCheck() {
  document.querySelectorAll('#myLinesInputs .num-input').forEach(function(inp) { inp.value = ''; inp.className = 'num-input'; });
  document.getElementById('jtpCheckLineCount').value = '3';
  jtpRebuildCheckLines();
  document.getElementById('comboCheck').checked = false;
  document.getElementById('checkResult').innerHTML = '';
  document.getElementById('jtpDrawDate').value = '';
  document.getElementById('jtpDrawnDisplay').style.display = 'none';
  document.getElementById('jtpDrawnBalls').innerHTML = '';
  document.getElementById('jtpDrawLookupMsg').textContent = '';
  jtpDrawn = [];
  jtpLastWin = null;
  fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: SID }) }).catch(function() {});
}

var chatMessages = document.getElementById('chatMessages');
var chatInput = document.getElementById('chatInput');
var chatSend = document.getElementById('chatSend');

function appendMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function sendChat() {
  var msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  chatSend.disabled = true;
  appendMsg('user', msg);
  var thinking = appendMsg('thinking', 'Thinking...');
  var jtpTickets = lastLines ? lastLines.length : 0;
  var jtpCombo = document.getElementById('jtpComboGen').checked;
  var jtpSpend = jtpTickets * (jtpCombo ? 2 : 1);
  var ctx = jtpTickets > 0 ? { spend: jtpSpend, lines: jtpTickets, game: 'jtp', won: jtpLastWin } : null;
  var _acChat = new AbortController(); setTimeout(function(){_acChat.abort();}, 15000);
  fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, context: ctx }), signal: _acChat.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) { thinking.remove(); appendMsg('bot', data.reply || data.error || 'No response.'); })
    .catch(function() { thinking.remove(); appendMsg('bot', 'Error reaching server.'); })
    .finally(function() { chatSend.disabled = false; chatInput.focus(); });
}

// Load email config on page start and check if configured
function loadEmailConfig() {
  var _acEC = new AbortController(); setTimeout(function(){_acEC.abort();}, 10000);
  fetch('/email/config', {signal: _acEC.signal})
    .then(function(res) { return res.json(); })
    .then(function(cfg) {
      var notConfigured = document.getElementById('emailNotConfigured');
      if (notConfigured) notConfigured.style.display = cfg.configured ? 'none' : 'block';
      if (cfg.configured) {
        document.getElementById('cfgApiKey').placeholder = cfg.keyMasked ? 'Saved (' + cfg.keyMasked + '...)' : 're_xxxxxxxxxxxxxxxxxxxx';
        if (cfg.from) document.getElementById('cfgFrom').value = cfg.from;
      }
    })
    .catch(function() {});
}

function toggleEmailSettings() {
  var body = document.getElementById('emailSettingsBody');
  var toggle = document.getElementById('emailSettingsToggle');
  var open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  toggle.textContent = open ? '▲ Hide' : '▼ Configure';
}

function saveEmailConfig() {
  var apiKey = document.getElementById('cfgApiKey').value.trim();
  var from   = document.getElementById('cfgFrom').value.trim();
  var status = document.getElementById('cfgStatus');
  if (!apiKey) { status.style.color = 'var(--red)'; status.textContent = 'Resend API key is required.'; return; }
  var body = { apiKey: apiKey };
  if (from) body.from = from;
  var _acECS = new AbortController(); setTimeout(function(){_acECS.abort();}, 10000);
  fetch('/email/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: _acECS.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { status.style.color = 'var(--red)'; status.textContent = data.error; }
      else { status.style.color = 'var(--green)'; status.textContent = 'Settings saved.'; loadEmailConfig(); }
    })
    .catch(function(err) { status.style.color = 'var(--red)'; status.textContent = 'Error: ' + err.message; });
}

function testEmailConfig() {
  var status = document.getElementById('cfgStatus');
  status.style.color = 'var(--muted)';
  status.textContent = 'Sending test email...';
  var _acET = new AbortController(); setTimeout(function(){_acET.abort();}, 10000);
  fetch('/email/test', { method: 'POST', signal: _acET.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { status.style.color = 'var(--red)'; status.textContent = 'Failed: ' + data.error; }
      else { status.style.color = 'var(--green)'; status.textContent = 'Test email sent to your configured address.'; }
    })
    .catch(function(err) { status.style.color = 'var(--red)'; status.textContent = 'Error: ' + err.message; });
}

function sendEmail() {
  var to = document.getElementById('emailTo').value.trim();
  var statusEl = document.getElementById('emailStatus');
  if (!to) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Please enter at least one email address.';
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  var incLines = document.getElementById('jtpEmailIncLines').checked && lastLines && lastLines.length > 0;
  var incWinning = document.getElementById('jtpEmailIncWinning').checked && jtpDrawn && jtpDrawn.length > 0;
  if (!incLines) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Generate lines first before sending.';
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  var btn = document.getElementById('emailSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  document.getElementById('emailStatus').textContent = '';
  var _acEM = new AbortController(); setTimeout(function(){_acEM.abort();}, 30000);
  fetch('/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, lines: incLines ? lastLines : [], nextDraw: lastNextDraw, winningNumbers: incWinning ? jtpDrawn : null, winDrawDate: incWinning ? document.getElementById('jtpDrawDate').value : null, winPrize: (incWinning && jtpLastWin != null) ? jtpLastWin : null }),
    signal: _acEM.signal
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        document.getElementById('emailStatus').style.color = 'var(--red)';
        document.getElementById('emailStatus').textContent = data.error;
      } else {
        document.getElementById('emailStatus').style.color = 'var(--green)';
        document.getElementById('emailStatus').textContent = 'Sent to ' + data.sent + ' recipient' + (data.sent > 1 ? 's' : '') + '.';
      }
    })
    .catch(function(err) {
      document.getElementById('emailStatus').style.color = 'var(--red)';
      document.getElementById('emailStatus').textContent = 'Error: ' + err.message;
    })
    .finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Lines'; });
}

function quickAsk(q) { chatInput.value = q; sendChat(); }

function openFAQ() { document.getElementById('faqModal').classList.add('show'); }
function closeFAQ() { document.getElementById('faqModal').classList.remove('show'); }

// switchTab defined at bottom of script (handles Pick 2/3/4 -> Pick 5 redirect)

// == Lotto X ==
var lxPressCount = 0;
var lxCountdownInterval = null;
var lxLastNextDraw = null;

fetch('/nextdraw/lottox')
  .then(function(r) { return r.json(); })
  .then(function(d) { lxStartCountdown({ nextDraw: d }); })
  .catch(function() {});

function lxStartCountdown(data) {
  var nd = data.nextDraw;
  document.getElementById('lxDrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('lxDrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('lxCloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  var badge = document.getElementById('lxSalesBadge');
  var banner = document.getElementById('lxDrawBanner');
  badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  badge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (lxCountdownInterval) clearInterval(lxCountdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('lxCountdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('lxCountdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  lxCountdownInterval = setInterval(tick, 1000);
}

var lxLastLines = null;
var lxLastWin = null;
var lxLatestDate = null;

function lxRenderLines(lines) {
  var container = document.getElementById('lxLinesContainer');
  var existing = container.querySelectorAll('.line-card');
  for (var i = 0; i < existing.length; i++) existing[i].classList.add('fading');
  lxLastLines = lines;
  document.getElementById('lxEmailCard').style.display = 'block';
  setTimeout(function() {
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var balls = '';
      for (var j = 0; j < l.numbers.length; j++) balls += '<div class="ball">' + l.numbers[j] + '</div>';
      html += '<div class="line-card' + (i === 0 ? ' best' : '') + '"><div class="line-label">' + (i === 0 ? 'Best' : 'Line ' + l.line) + '</div><div class="balls">' + balls + '</div><div class="score-wrap"><div class="score-label">' + l.score + '</div><div class="score-info" title="What is this score?">?<div class="score-tooltip"><strong>What is this score?</strong>Higher = statistically stronger line. Scored on: frequency (40 pts), recency in last 50 draws (20 pts), pair co-occurrence (15 pts), low/high balance (5 pts), spread across 1–53 (10 pts). Does NOT predict winners.</div></div></div></div>';
    }
    container.innerHTML = html;
  }, 150);
}

function lxRenderHistory(history) {
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = '';
    for (var j = 0; j < d.numbers.length; j++) balls += '<div class="hball">' + d.numbers[j] + '</div>';
    html += '<div class="history-row"><div class="history-date">' + d.date + '</div><div class="history-balls">' + balls + '</div></div>';
  }
  document.getElementById('lxHistoryContainer').innerHTML = html;
}

function lxRenderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('lxTopTable').innerHTML = rows(top);
  document.getElementById('lxBottomTable').innerHTML = rows(bottom);
}

function lxRenderAll(data) {
  lxStartCountdown(data);
  lxLastNextDraw = data.nextDraw;
  document.getElementById('lxDrawsBadge').textContent = data.totalDraws + ' draws analyzed';
  document.getElementById('lxUpdatedLabel').textContent = 'Data as of: ' + data.lastUpdated;
  lxRenderHistory(data.recentHistory);
  lxRenderFreq(data.topNumbers, data.bottomNumbers);
  document.getElementById('lxResults').style.display = 'block';
}

function lxSetStatus(type, text) {
  var el = document.getElementById('lxStatusMsg');
  el.className = 'status-msg ' + type;
  el.textContent = text;
}
function lxClearStatus() { document.getElementById('lxStatusMsg').style.display = 'none'; }

function lxGenerate() {
  var btn = document.getElementById('lxGenerateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  lxClearStatus();
  var count = Math.min(Math.max(parseInt(document.getElementById('lxLineCount').value) || 6, 1), 100);
  var _acLX = new AbortController(); setTimeout(function(){_acLX.abort();}, 30000);
  fetch('/analyze/lottox?count=' + count + '&sid=' + SID, {signal:_acLX.signal})
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      lxPressCount++;
      document.getElementById('lxPressNum').textContent = lxPressCount;
      document.getElementById('lxPressHint').style.display = 'block';
      document.getElementById('lxEmailBlurb').style.display = 'block';
      if (lxPressCount === 1) lxRenderAll(r.data);
      else lxStartCountdown(r.data);
      lxRenderLines(r.data.lines);
      lxClearStatus();
    })
    .catch(function(err) { lxSetStatus('error', 'Error: ' + err.message); })
    .finally(function() { btn.disabled = false; btn.textContent = '🍀 Generate Lines'; });
}

var lxDrawn = [];

function lxRebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('lxCheckLineCount').value) || 1, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="lxLineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2"><input class="num-input" placeholder="#6" maxlength="2"></div></div>';
  }
  document.getElementById('lxLinesInputs').innerHTML = html;
}
lxRebuildCheckLines();

function lxRebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('lxCheckLineCount').value) || 1, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="lxLineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2"><input class="num-input" placeholder="#6" maxlength="2"></div></div>';
  }
  document.getElementById('lxLinesInputs').innerHTML = html;
}
lxRebuildCheckLines();

function lxLookupDraw() {
  var dateVal = document.getElementById('lxDrawDate').value;
  var msg = document.getElementById('lxDrawLookupMsg');
  var display = document.getElementById('lxDrawnDisplay');
  lxDrawn = [];
  display.style.display = 'none';
  document.getElementById('lxDrawnBalls').innerHTML = '';
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Looking up...';
  var _lxDate = dateVal;
  if (window._lxLookupAC) window._lxLookupAC.abort('new-lookup');
  window._lxLookupAC = new AbortController(); setTimeout(function(){if(window._lxLookupAC)window._lxLookupAC.abort('timeout');},60000);
  (function(){return fetch('/draws/lottox?date=' + encodeURIComponent(mmddyy),{signal:window._lxLookupAC.signal});})()
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (document.getElementById('lxDrawDate').value !== _lxDate) return;
      if (data.error) {
        msg.style.color = 'var(--red)';
        msg.textContent = data.error;
        if (data.resultsUrl) {
          msg.innerHTML = data.error + ' <a href="' + data.resultsUrl + '" target="_blank" style="color:var(--accent);">View official results</a>';
        }
        return;
      }
      lxDrawn = data.numbers;
      msg.textContent = '';
      display.style.display = 'block';
            var lxIsLatest = lxLatestDate && document.getElementById('lxDrawDate').value === lxLatestDate;
      var lxBallStyle = lxIsLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
      document.getElementById('lxDrawnBalls').innerHTML = data.numbers.map(function(n) {
        return '<div class="hball" style="' + lxBallStyle + ';width:36px;height:36px;font-size:13px;">' + n + '</div>';
      }).join('');
    })
    .catch(function(e) { if (e && e.name === 'AbortError') { msg.textContent = ''; return; } msg.style.color = 'var(--red)'; msg.textContent = 'Lookup failed.'; });
}

function lxCheckNumbers() {
  if (!lxDrawn.length) {
    document.getElementById('lxCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>';
    return;
  }
  var drawn = lxDrawn;
  var lineRows = document.querySelectorAll('#lxLinesInputs .line-input-row');
  var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 53) {
        document.getElementById('lxCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Please enter all 6 numbers for Line ' + (r+1) + ' (1-53).</div>';
        return;
      }
      line.push(lv);
    }
    allLines.push(line);
  }
  var line = allLines[0];
  var mult = parseInt(document.getElementById('lxMultiplier').value) || 1;
  var ezMatch = parseInt(document.getElementById('lxEZMatch').value) || 0;
  var dpDrawn = null;
  if (document.getElementById('lxDPCheck').checked) {
    var dpInputs = document.querySelectorAll('#lxDPDrawnInputs .num-input');
    dpDrawn = [];
    for (var k = 0; k < dpInputs.length; k++) {
      var dpv = parseInt(dpInputs[k].value.trim());
      if (isNaN(dpv) || dpv < 1 || dpv > 53) {
        document.getElementById('lxCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Please enter all 6 Double Play winning numbers (1–53).</div>';
        return;
      }
      dpDrawn.push(dpv);
    }
  }
  var drawnSet = {};
  drawn.forEach(function(n) { drawnSet[n] = true; });
  document.querySelectorAll('#lxLinesInputs .num-input').forEach(function(inp) {
    var v = parseInt(inp.value);
    inp.className = 'num-input' + (drawnSet[v] ? ' matched' : '');
  });
  var lxResultEl = document.getElementById('lxCheckResult');
  lxResultEl.innerHTML = '';
  var lxAllResults = [];
  var lxTotalWinAcc = 0;
  var lxPending = allLines.length;
  allLines.forEach(function(lineNums, lineIdx) {
    var _acLXC = new AbortController(); setTimeout(function(){_acLXC.abort();}, 15000);
    fetch('/check/lottox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drawn: drawn, line: lineNums, multiplier: mult, doublePlayDrawn: lineIdx === 0 ? dpDrawn : null, ezMatch: lineIdx === 0 ? ezMatch : 0 }), signal: _acLXC.signal })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.error) { lxResultEl.innerHTML = '<div style="color:var(--red);">' + data.error + '</div>'; return; }
        lxAllResults[lineIdx] = data;
        lxTotalWinAcc += data.totalWin || 0;
        lxPending--;
        if (lxPending > 0) return;
        var html = '';
        lxAllResults.forEach(function(d, idx) {
          var matchedNums = d.matched.join(', ') || 'none';
          var isWinner = d.isJackpot || d.isFree || d.prize > 0;
          var prizeColor = d.isJackpot ? 'var(--yellow)' : (isWinner ? 'var(--green)' : 'var(--muted)');
          var label = lxAllResults.length > 1 ? 'Line ' + (idx+1) : 'Base Game';
          html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '">';
          html += '<span style="font-weight:700;">' + label + '</span> &mdash; ' + d.count + ' match' + (d.count !== 1 ? 'es' : '') + ' (' + matchedNums + ')';
          if (d.multiplied) html += ' &mdash; <span style="color:var(--accent);font-size:11px;">' + d.multiplier + 'x applied</span>';
          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
          if (idx === 0 && d.ezMatch > 0) html += '<div class="check-line-result winner" style="border-color:var(--green);"><span style="font-weight:700;">EZMatch</span> &mdash; <span style="color:var(--green);font-weight:700;">$' + d.ezMatch.toLocaleString() + '</span></div>';
          if (idx === 0 && d.doublePlay && d.doublePlay.display) {
            var dpWin = d.doublePlay.prize > 0;
            html += '<div class="check-line-result' + (dpWin ? ' winner' : '') + '" style="' + (dpWin ? 'border-color:var(--accent);' : '') + '"><span style="font-weight:700;">Double Play</span> &mdash; ' + d.doublePlay.count + ' match' + (d.doublePlay.count !== 1 ? 'es' : '') + ' &mdash; <span style="color:' + (dpWin ? 'var(--accent)' : 'var(--muted)') + ';font-weight:700;">' + d.doublePlay.display + '</span></div>';
          }
        });
        var totalLabel = lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
        var totalDisplay = lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0';
        lxLastWin = lxTotalWinAcc;
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div>';
        if (lxAllResults.length > 1) html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Total across ' + lxAllResults.length + ' lines. Base prizes are pari-mutuel estimates.</div>';
        else html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Base prizes are pari-mutuel estimates. Jackpot varies.</div>';
        html += '</div>';
        lxResultEl.innerHTML = html;
      })
      .catch(function(err) { lxResultEl.innerHTML = '<div style="color:var(--red);">Error: ' + err.message + '</div>'; });
  });
}

function lxClearCheck() {
  document.getElementById('lxCheckLineCount').value = '1';
  lxRebuildCheckLines();
  document.querySelectorAll('#lxDPDrawnInputs .num-input').forEach(function(inp) { inp.value = ''; inp.className = 'num-input'; });
  document.getElementById('lxMultiplier').value = '1';
  document.getElementById('lxEZMatch').value = '0';
  document.getElementById('lxDPCheck').checked = false;
  document.getElementById('lxDPInputs').style.display = 'none';
  document.getElementById('lxCheckResult').innerHTML = '';
  document.getElementById('lxDrawDate').value = '';
  document.getElementById('lxDrawnDisplay').style.display = 'none';
  document.getElementById('lxDrawnBalls').innerHTML = '';
  document.getElementById('lxDrawLookupMsg').textContent = '';
  lxDrawn = [];
  lxLastWin = null;
}

function lxAppendMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  var msgs = document.getElementById('lxChatMessages');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function lxSendEmail() {
  var to = document.getElementById('lxEmailTo').value.trim();
  if (!to) {
    document.getElementById('lxEmailStatus').style.color = 'var(--red)';
    document.getElementById('lxEmailStatus').textContent = 'Please enter at least one email address.';
    return;
  }
  var incLines = document.getElementById('lxEmailIncLines').checked && lxLastLines && lxLastLines.length > 0;
  var incWinning = document.getElementById('lxEmailIncWinning').checked && lxDrawn.length > 0;
  if (!incLines) {
    document.getElementById('lxEmailStatus').style.color = 'var(--red)';
    document.getElementById('lxEmailStatus').textContent = 'Generate lines first before sending.';
    return;
  }
  var btn = document.getElementById('lxEmailSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  document.getElementById('lxEmailStatus').textContent = '';
  var _acLXE = new AbortController(); setTimeout(function(){_acLXE.abort();}, 30000);
  fetch('/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, lines: incLines ? lxLastLines : [], nextDraw: lxLastNextDraw, game: 'lottox', winningNumbers: incWinning ? lxDrawn : null, winDrawDate: incWinning ? document.getElementById('lxDrawDate').value : null, winPrize: (incWinning && lxLastWin != null) ? lxLastWin : null }),
    signal: _acLXE.signal
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        document.getElementById('lxEmailStatus').style.color = 'var(--red)';
        document.getElementById('lxEmailStatus').textContent = data.error;
      } else {
        document.getElementById('lxEmailStatus').style.color = 'var(--green)';
        document.getElementById('lxEmailStatus').textContent = 'Sent to ' + data.sent + ' recipient' + (data.sent > 1 ? 's' : '') + '.';
      }
    })
    .catch(function(err) {
      document.getElementById('lxEmailStatus').style.color = 'var(--red)';
      document.getElementById('lxEmailStatus').textContent = 'Error: ' + err.message;
    })
    .finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Lines'; });
}

function lxSendChat() {
  var input = document.getElementById('lxChatInput');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  var btn = document.getElementById('lxChatSend');
  btn.disabled = true;
  lxAppendMsg('user', msg);
  var thinking = lxAppendMsg('thinking', 'Thinking...');
  var lxTickets = lxLastLines ? lxLastLines.length : 0;
  var lxEZ = document.getElementById('lxEZMatchGen').checked;
  var lxDP = document.getElementById('lxDPGen').checked;
  var lxSpend = lxTickets * (2 + (lxEZ ? 1 : 0) + (lxDP ? 1 : 0));
  var lxCtx = lxTickets > 0 ? { spend: lxSpend, lines: lxTickets, game: 'lottox', won: lxLastWin } : null;
  var _acLXChat = new AbortController(); setTimeout(function(){_acLXChat.abort();}, 15000);
  fetch('/chat/lottox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, context: lxCtx }), signal: _acLXChat.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) { thinking.remove(); lxAppendMsg('bot', data.reply || data.error || 'No response.'); })
    .catch(function() { thinking.remove(); lxAppendMsg('bot', 'Error reaching server.'); })
    .finally(function() { btn.disabled = false; input.focus(); });
}

function lxQuickAsk(q) { document.getElementById('lxChatInput').value = q; lxSendChat(); }

document.getElementById('lxChatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') lxSendChat(); });
document.getElementById('lxResults').style.display = 'none';

// == Cash Pop ==
var cpCountdownInterval = null;
var cpLastNumbers = null;
var cpLastNextDraw = null;
var cpLastWin = null;
var cpLatestDate = null;
var cpLatestSession = null;
var cpWinNum = null;

fetch('/nextdraw/cashpop')
  .then(function(r) { return r.json(); })
  .then(function(d) { cpStartCountdown(d); })
  .catch(function() {});

function cpStartCountdown(nd) {
  document.getElementById('cpDrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('cpDrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('cpCloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  document.getElementById('cpDrawName').textContent = nd.drawName;
  var badge = document.getElementById('cpSalesBadge');
  var banner = document.getElementById('cpDrawBanner');
  badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  badge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (cpCountdownInterval) clearInterval(cpCountdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('cpCountdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('cpCountdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  cpCountdownInterval = setInterval(tick, 1000);
}

function cpGenerate() {
  var btn = document.getElementById('cpGenerateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  document.getElementById('cpStatusMsg').style.display = 'none';
  var count = Math.min(Math.max(parseInt(document.getElementById('cpNumCount').value) || 5, 1), 15);
  var _acCP = new AbortController(); setTimeout(function(){_acCP.abort();}, 30000);
  fetch('/analyze/cashpop?count=' + count + '&sid=' + SID, {signal:_acCP.signal})
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      cpStartCountdown(r.data.nextDraw);
      var container = document.getElementById('cpNumbersContainer');
      container.innerHTML = r.data.numbers.map(function(n) {
        return '<div class="ball" style="background:var(--yellow);color:#000;font-weight:700;font-size:18px;width:48px;height:48px;line-height:48px;">' + n + '</div>';
      }).join('');
      document.getElementById('cpOddsBadge').textContent = r.data.totalDraws + ' draw-days analyzed';
      document.getElementById('cpUpdatedLabel').textContent = 'Data as of: ' + r.data.lastUpdated;
      if (r.data.recentHistory) cpRenderHistory(r.data.recentHistory);
      if (r.data.topNumbers) cpRenderFreq(r.data.topNumbers, r.data.bottomNumbers);
      cpLastNumbers = r.data.numbers;
      cpLastNextDraw = r.data.nextDraw;
      document.getElementById('cpEmailCard').style.display = 'block';
      document.getElementById('cpResults').style.display = 'block';
    })
    .catch(function(err) {
      var el = document.getElementById('cpStatusMsg');
      el.className = 'status-msg error'; el.textContent = 'Error: ' + err.message; el.style.display = 'block';
    })
    .finally(function() { btn.disabled = false; btn.textContent = '\u{1F4B0} Generate Numbers'; });
}

function cpRenderHistory(history) {
  var DRAW_NAMES = ['Morning','Matinee','Afternoon','Evening','Late Night'];
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = d.numbers.map(function(n, j) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;"><span style="font-size:10px;color:var(--muted);">' + DRAW_NAMES[j] + ':</span><div class="hball">' + n + '</div></span>';
    }).join('');
    html += '<div class="history-row"><div class="history-date">' + d.date + '</div><div class="history-balls" style="flex-wrap:wrap;gap:4px;">' + balls + '</div></div>';
  }
  document.getElementById('cpHistoryContainer').innerHTML = html;
}

function cpRenderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('cpTopTable').innerHTML = rows(top);
  document.getElementById('cpBottomTable').innerHTML = rows(bottom);
}

function cpCheckNumbers() {
  var wn = (typeof cpWinNum === 'number' && cpWinNum >= 1 && cpWinNum <= 15) ? cpWinNum : parseInt(document.getElementById('cpWinNum') ? document.getElementById('cpWinNum').value : '');
  var yn = parseInt(document.getElementById('cpYourNum').value);
  var pa = parseInt(document.getElementById('cpPlayAmt').value);
  var pm = parseInt(document.getElementById('cpMultiplier').value);
  var res = document.getElementById('cpCheckResult');
  if (isNaN(wn) || wn < 1 || wn > 15 || isNaN(yn) || yn < 1 || yn > 15) {
    res.innerHTML = '<div style="color:var(--red);font-size:13px;">' + (isNaN(wn) ? 'Select a draw date and session first to load the winning number.' : 'Enter a valid number (1-15) in Your Number.') + '</div>'; return;
  }
  if (isNaN(pm) || pm < 5 || pm > 250) {
    res.innerHTML = '<div style="color:var(--red);font-size:13px;">Enter your prize multiplier (5-250) from your ticket.</div>'; return;
  }
  var _acCPC = new AbortController(); setTimeout(function(){_acCPC.abort();}, 15000);
  fetch('/check/cashpop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winningNumber: wn, yourNumber: yn, playAmount: pa, prizeMultiplier: pm }), signal: _acCPC.signal })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { res.innerHTML = '<div style="color:var(--red);">' + data.error + '</div>'; return; }
      var html = '';
      document.getElementById('cpYourNum').className = 'num-input' + (data.matched ? ' matched' : '');
      if (data.matched) {
        html += '<div class="check-line-result winner"><span style="font-weight:700;">Match!</span> Your number ' + data.yourNumber + ' = winning number ' + data.winningNumber + ' &mdash; <span style="color:var(--green);font-weight:700;">$' + data.playAmount + ' x ' + data.prizeMultiplier + 'x = $' + data.prize.toLocaleString() + '</span></div>';
        if (data.withholding > 0) html += '<div class="check-line-result">Federal withholding (24%): -$' + data.withholding.toLocaleString() + '</div>';
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Estimated Take-Home</div><div class="amount" style="color:var(--yellow);">~$' + data.takeHome.toLocaleString() + '</div></div>';
        cpLastWin = data.takeHome;
      } else {
        cpLastWin = 0;
        html += '<div class="check-line-result"><span style="font-weight:700;">No Match</span> &mdash; Your number: ' + data.yourNumber + ' &mdash; Winning number: ' + data.winningNumber + ' &mdash; <span style="color:var(--muted);font-weight:700;">$0</span></div>';
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">No Prize This Draw</div><div class="amount" style="color:var(--muted);">$0</div></div>';
      }
      res.innerHTML = html;
    })
    .catch(function(err) { res.innerHTML = '<div style="color:var(--red);">Error: ' + err.message + '</div>'; });
}

function cpClearCheck() {
  document.getElementById('cpYourNum').value = '';
  document.getElementById('cpYourNum').className = 'num-input';
  document.getElementById('cpMultiplier').value = '';
  document.getElementById('cpCheckResult').innerHTML = '';
  cpLastWin = null;
  if (cpLatestDate) { document.getElementById('cpDrawDate').value = cpLatestDate; document.getElementById('cpDrawSession').value = cpLatestSession || 'Morning'; cpLookupDraw(true); }
}

function cpAppendMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  var msgs = document.getElementById('cpChatMessages');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function cpLookupDraw(forceLatest) {
  var dateVal = document.getElementById('cpDrawDate').value;
  var session = document.getElementById('cpDrawSession').value;
  var msg = document.getElementById('cpDrawLookupMsg');
  var display = document.getElementById('cpDrawnDisplay');
  cpWinNum = null;
  display.style.display = 'none';
  document.getElementById('cpDrawnBalls').innerHTML = '';
  if (!msg) return;
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyyyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Looking up...';
  var _cpDate = dateVal;
  if (window._cpLookupAC) window._cpLookupAC.abort('new-lookup');
  window._cpLookupAC = new AbortController(); setTimeout(function(){if(window._cpLookupAC)window._cpLookupAC.abort('timeout');},60000);
  (function(){return fetch('/draws/cashpop?date=' + encodeURIComponent(mmddyyyy),{signal:window._cpLookupAC.signal});})()
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (document.getElementById('cpDrawDate').value !== _cpDate) return;
      if (data.error && !data.allSessions) {
        msg.style.color = 'var(--red)';
        msg.textContent = data.error;
        if (data.resultsUrl) msg.innerHTML = data.error + ' <a href="' + data.resultsUrl + '" target="_blank" style="color:var(--accent);">View official results</a>';
        return;
      }
      var sessions = data.allSessions || (data.number ? [{ name: data.session, number: data.number }] : []);
      if (!sessions.length) { msg.style.color = 'var(--red)'; msg.textContent = 'No sessions found for that date.'; return; }
      var target = sessions.find(function(s) { return s.name === session; }) || sessions[sessions.length - 1];
      document.getElementById('cpDrawSession').value = target.name;
      if (cpLatestDate && document.getElementById('cpDrawDate').value === cpLatestDate) cpLatestSession = target.name;
      cpWinNum = target.number;
      var inp = document.getElementById('cpWinNum');
      if (inp) inp.value = target.number;
      msg.textContent = '';
      display.style.display = 'block';
      var _isLatest = forceLatest || (cpLatestDate && document.getElementById('cpDrawDate').value === cpLatestDate);
      var _ballStyle = _isLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
      document.getElementById('cpDrawnBalls').innerHTML =
        '<div class="hball" style="' + _ballStyle + ';width:36px;height:36px;font-size:13px;">' + target.number + '</div>' +
        '<span style="font-size:12px;color:var(--muted);margin-left:8px;">' + target.name + '</span>';
    })
    .catch(function(e) { if (e && e.name === 'AbortError') { msg.textContent = ''; return; } msg.style.color = 'var(--red)'; msg.textContent = 'Lookup failed.'; });
}
function cpSendChat() {
  var input = document.getElementById('cpChatInput');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  var btn = document.getElementById('cpChatSend');
  btn.disabled = true;
  cpAppendMsg('user', msg);
  var thinking = cpAppendMsg('thinking', 'Thinking...');
  var cpNums = cpLastNumbers ? cpLastNumbers.length : 0;
  var cpAmt = parseInt(document.getElementById('cpPlayAmtGen').value) || 5;
  var cpSpend = cpNums * cpAmt;
  var cpCtx = cpNums > 0 ? { spend: cpSpend, lines: cpNums, game: 'cashpop', won: cpLastWin } : null;
  var _acCPChat = new AbortController(); setTimeout(function(){_acCPChat.abort();}, 15000);
  fetch('/chat/cashpop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, context: cpCtx }), signal: _acCPChat.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) { thinking.remove(); cpAppendMsg('bot', data.reply || data.error || 'No response.'); })
    .catch(function() { thinking.remove(); cpAppendMsg('bot', 'Error reaching server.'); })
    .finally(function() { btn.disabled = false; input.focus(); });
}

function cpSendEmail() {
  var to = document.getElementById('cpEmailTo').value.trim();
  if (!to) {
    document.getElementById('cpEmailStatus').style.color = 'var(--red)';
    document.getElementById('cpEmailStatus').textContent = 'Please enter at least one email address.';
    return;
  }
  var cpWinNum = (typeof window.cpWinNum === 'number' && window.cpWinNum >= 1 && window.cpWinNum <= 15) ? window.cpWinNum : NaN;
  var incLines = document.getElementById('cpEmailIncLines').checked && cpLastNumbers && cpLastNumbers.length > 0;
  var incWinning = document.getElementById('cpEmailIncWinning').checked && !isNaN(cpWinNum) && cpWinNum >= 1 && cpWinNum <= 15;
  if (!incLines) {
    document.getElementById('cpEmailStatus').style.color = 'var(--red)';
    document.getElementById('cpEmailStatus').textContent = 'Generate numbers first before sending.';
    return;
  }
  var btn = document.getElementById('cpEmailSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  document.getElementById('cpEmailStatus').textContent = '';
  var lines = incLines ? [{ line: 1, numbers: cpLastNumbers, score: '' }] : [];
  var _acCPE = new AbortController(); setTimeout(function(){_acCPE.abort();}, 30000);
  fetch('/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, lines: lines, nextDraw: cpLastNextDraw, game: 'cashpop', winningNumbers: incWinning ? [cpWinNum] : null }),
    signal: _acCPE.signal
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        document.getElementById('cpEmailStatus').style.color = 'var(--red)';
        document.getElementById('cpEmailStatus').textContent = data.error;
      } else {
        document.getElementById('cpEmailStatus').style.color = 'var(--green)';
        document.getElementById('cpEmailStatus').textContent = 'Sent to ' + data.sent + ' recipient' + (data.sent > 1 ? 's' : '') + '.';
      }
    })
    .catch(function(err) {
      document.getElementById('cpEmailStatus').style.color = 'var(--red)';
      document.getElementById('cpEmailStatus').textContent = 'Error: ' + err.message;
    })
    .finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Numbers'; });
}

function cpQuickAsk(q) { document.getElementById('cpChatInput').value = q; cpSendChat(); }

document.getElementById('cpChatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') cpSendChat(); });

// == Cost calculators ==
function jtpUpdateCost() {
  var tickets = Math.min(Math.max(parseInt(document.getElementById('lineCount').value) || 6, 1), 100);
  var combo = document.getElementById('jtpComboGen').checked;
  var base = tickets * 1;
  var comboAmt = combo ? tickets * 1 : 0;
  var total = base + comboAmt;
  var parts = tickets + ' ticket' + (tickets !== 1 ? 's' : '') + ' x $1 = $' + base;
  if (combo) parts += '  +  Combo ' + tickets + ' x $1 = $' + comboAmt;
  document.getElementById('jtpCostBreakdown').textContent = parts;
  document.getElementById('jtpCostTotal').textContent = 'Total: $' + total;
}

function lxUpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('lxLineCount').value) || 6, 1), 100);
  var ez = document.getElementById('lxEZMatchGen').checked;
  var dp = document.getElementById('lxDPGen').checked;
  var base = count * 2;
  var ezAmt = ez ? count * 1 : 0;
  var dpAmt = dp ? count * 1 : 0;
  var total = base + ezAmt + dpAmt;
  var parts = count + ' ticket' + (count !== 1 ? 's' : '') + ' x $2 = $' + base;
  if (ez) parts += '  +  EZMatch ' + count + ' x $1 = $' + ezAmt;
  if (dp) parts += '  +  Double Play ' + count + ' x $1 = $' + dpAmt;
  document.getElementById('lxCostBreakdown').textContent = parts;
  document.getElementById('lxCostTotal').textContent = 'Total: $' + total;
}

function cpUpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('cpNumCount').value) || 5, 1), 15);
  var amt = parseInt(document.getElementById('cpPlayAmtGen').value) || 5;
  var total = count * amt;
  document.getElementById('cpCostBreakdown').textContent = count + ' number' + (count !== 1 ? 's' : '') + ' x $' + amt + ' each';
  document.getElementById('cpCostTotal').textContent = 'Total: $' + total;
}

function f5UpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('f5LineCount').value) || 6, 1), 100);
  var ez = document.getElementById('f5EZMatchGen').checked;
  var base = count * 1;
  var ezAmt = ez ? count * 1 : 0;
  var total = base + ezAmt;
  var parts = count + ' ticket' + (count !== 1 ? 's' : '') + ' x $1 = $' + base;
  if (ez) parts += '  +  EZMatch ' + count + ' x $1 = $' + ezAmt;
  document.getElementById('f5CostBreakdown').textContent = parts;
  document.getElementById('f5CostTotal').textContent = 'Total: $' + total;
}

function pbUpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('pbLineCount').value) || 6, 1), 100);
  var pp = document.getElementById('pbPowerPlay').checked;
  var dp = document.getElementById('pbDoublePlay').checked;
  var base = count * 2;
  var ppAmt = pp ? count * 1 : 0;
  var dpAmt = dp ? count * 1 : 0;
  var total = base + ppAmt + dpAmt;
  var parts = count + ' play' + (count !== 1 ? 's' : '') + ' x $2 = $' + base;
  if (pp) parts += '  +  Power Play ' + count + ' x $1 = $' + ppAmt;
  if (dp) parts += '  +  Double Play ' + count + ' x $1 = $' + dpAmt;
  document.getElementById('pbCostBreakdown').textContent = parts;
  document.getElementById('pbCostTotal').textContent = 'Total: $' + total;
}

jtpUpdateCost();
lxUpdateCost();
cpUpdateCost();
f5UpdateCost();
pbUpdateCost();
// mmUpdateCost() called after MM section init
// pickUpdateCost() is called inside pickSetGame() on init

function f5SendEmail() {
  var to = document.getElementById('f5EmailTo').value.trim();
  if (!to) {
    document.getElementById('f5EmailStatus').style.color = 'var(--red)';
    document.getElementById('f5EmailStatus').textContent = 'Please enter at least one email address.';
    return;
  }
  var incLines = document.getElementById('f5EmailIncLines').checked && f5LastLines && f5LastLines.length > 0;
  var incWinning = document.getElementById('f5EmailIncWinning').checked && f5Drawn.length > 0;
  if (!incLines) {
    document.getElementById('f5EmailStatus').style.color = 'var(--red)';
    document.getElementById('f5EmailStatus').textContent = 'Generate lines first before sending.';
    return;
  }
  var btn = document.getElementById('f5EmailSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  document.getElementById('f5EmailStatus').textContent = '';
  var tickets = f5LastLines ? f5LastLines.length : 0;
  var ez = document.getElementById('f5EZMatchGen').checked;
  var context = { spend: tickets * (ez ? 2 : 1), lines: tickets, game: 'fantasy5', won: f5LastWin };
  var _acF5E = new AbortController(); setTimeout(function(){_acF5E.abort();}, 30000);
  fetch('/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, lines: incLines ? f5LastLines : [], nextDraw: f5LastNextDraw, game: 'fantasy5', winningNumbers: incWinning ? f5Drawn : null, winDrawDate: incWinning ? document.getElementById('f5DrawDate').value : null, winDrawType: incWinning ? document.getElementById('f5DrawType').value : null, winPrize: (incWinning && f5LastWin != null) ? f5LastWin : null }),
    signal: _acF5E.signal
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        document.getElementById('f5EmailStatus').style.color = 'var(--red)';
        document.getElementById('f5EmailStatus').textContent = data.error;
      } else {
        document.getElementById('f5EmailStatus').style.color = 'var(--green)';
        document.getElementById('f5EmailStatus').textContent = 'Sent to ' + data.sent + ' recipient' + (data.sent > 1 ? 's' : '') + '.';
      }
    })
    .catch(function(err) {
      document.getElementById('f5EmailStatus').style.color = 'var(--red)';
      document.getElementById('f5EmailStatus').textContent = 'Error: ' + err.message;
    })
    .finally(function() { btn.disabled = false; btn.innerHTML = '&#128140; Send Lines'; });
}

// == Fantasy 5 ==
var f5PressCount = 0;
var f5CountdownInterval = null;
var f5LastLines = null;
var f5LastNextDraw = null;
var f5LastWin = null;
var f5LatestDate = null;

fetch('/nextdraw/fantasy5')
  .then(function(r) { return r.json(); })
  .then(function(d) { f5StartCountdown(d); })
  .catch(function() {});

function f5StartCountdown(nd) {
  document.getElementById('f5DrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('f5DrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('f5CloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  document.getElementById('f5DrawName').textContent = nd.drawName;
  var badge = document.getElementById('f5SalesBadge');
  var banner = document.getElementById('f5DrawBanner');
  badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  badge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (f5CountdownInterval) clearInterval(f5CountdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('f5Countdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('f5Countdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  f5CountdownInterval = setInterval(tick, 1000);
}

function f5RenderLines(lines) {
  var container = document.getElementById('f5LinesContainer');
  var existing = container.querySelectorAll('.line-card');
  for (var i = 0; i < existing.length; i++) existing[i].classList.add('fading');
  f5LastLines = lines;
  document.getElementById('f5EmailCard').style.display = 'block';
  setTimeout(function() {
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var balls = '';
      for (var j = 0; j < l.numbers.length; j++) balls += '<div class="ball">' + l.numbers[j] + '</div>';
      html += '<div class="line-card' + (i === 0 ? ' best' : '') + '"><div class="line-label">' + (i === 0 ? 'Best' : 'Line ' + l.line) + '</div><div class="balls">' + balls + '</div><div class="score-wrap"><div class="score-label">' + l.score + '</div><div class="score-info" title="What is this score?">?<div class="score-tooltip"><strong>What is this score?</strong>Higher = statistically stronger line. Scored on: frequency (40 pts), recency in last 50 draws (20 pts), pair co-occurrence (15 pts), low/high balance (5 pts), spread across 1-36 (10 pts). Does NOT predict winners.</div></div></div></div>';
    }
    container.innerHTML = html;
  }, 150);
}

function f5RenderHistory(history) {
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = '';
    for (var j = 0; j < d.numbers.length; j++) balls += '<div class="hball">' + d.numbers[j] + '</div>';
    var label = d.drawType ? '<span style="font-size:10px;color:var(--muted);margin-left:4px;">' + d.drawType.charAt(0).toUpperCase() + d.drawType.slice(1).toLowerCase() + '</span>' : '';
    html += '<div class="history-row"><div class="history-date">' + d.date + label + '</div><div class="history-balls">' + balls + '</div></div>';
  }
  document.getElementById('f5HistoryContainer').innerHTML = html;
}

function f5RenderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('f5TopTable').innerHTML = rows(top);
  document.getElementById('f5BottomTable').innerHTML = rows(bottom);
}

function f5RenderAll(data) {
  f5StartCountdown(data.nextDraw);
  f5LastNextDraw = data.nextDraw;
  document.getElementById('f5DrawsBadge').textContent = data.totalDraws + ' draws analyzed';
  document.getElementById('f5UpdatedLabel').textContent = 'Data as of: ' + data.lastUpdated;
  f5RenderHistory(data.recentHistory);
  f5RenderFreq(data.topNumbers, data.bottomNumbers);
  document.getElementById('f5Results').style.display = 'block';
}

function f5Generate() {
  var btn = document.getElementById('f5GenerateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  var el = document.getElementById('f5StatusMsg');
  el.className = 'status-msg loading';
  el.textContent = 'Analyzing complete draw history -- Fantasy 5 has 2 draws per day so this can take a minute or two. Hang tight!';
  el.style.display = 'block';
  var count = Math.min(Math.max(parseInt(document.getElementById('f5LineCount').value) || 6, 1), 100);
  var _acF5 = new AbortController(); setTimeout(function(){_acF5.abort();}, 30000);
  fetch('/analyze/fantasy5?count=' + count + '&sid=' + SID, {signal:_acF5.signal})
    .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      f5PressCount++;
      document.getElementById('f5PressNum').textContent = f5PressCount;
      document.getElementById('f5PressHint').style.display = 'block';
      document.getElementById('f5EmailBlurb').style.display = 'block';
      if (f5PressCount === 1) f5RenderAll(r.data);
      else f5StartCountdown(r.data.nextDraw);
      f5RenderLines(r.data.lines);
    })
    .catch(function(err) {
      var el = document.getElementById('f5StatusMsg');
      el.className = 'status-msg error'; el.textContent = 'Error: ' + err.message; el.style.display = 'block';
    })
    .finally(function() { btn.disabled = false; btn.textContent = '\u2728 Generate Lines'; });
}

function f5RebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('f5CheckLineCount').value) || 1, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="f5LineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2"></div></div>';
  }
  document.getElementById('f5LinesInputs').innerHTML = html;
}
f5RebuildCheckLines();

var f5Drawn = [];

function f5LookupDraw() {
  var dateVal = document.getElementById('f5DrawDate').value;
  var drawType = document.getElementById('f5DrawType').value;
  var msg = document.getElementById('f5DrawLookupMsg');
  var display = document.getElementById('f5DrawnDisplay');
  f5Drawn = [];
  display.style.display = 'none';
  document.getElementById('f5DrawnBalls').innerHTML = '';
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyyyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Looking up...';
  var _primary = drawType === 'EVENING' ? 'EVENING' : 'MIDDAY';
  var _fallback = _primary === 'EVENING' ? 'MIDDAY' : 'EVENING';
  var _f5Date = dateVal;
  if (window._f5LookupAC) window._f5LookupAC.abort('new-lookup');
  window._f5LookupAC = new AbortController();
  var _f5Signal = window._f5LookupAC.signal;
  setTimeout(function(){if(window._f5LookupAC)window._f5LookupAC.abort('timeout');},60000);
  function _f5Fetch(dt) {
    return fetch('/draws/fantasy5?date=' + encodeURIComponent(mmddyyyy) + '&draw=' + dt, {signal:_f5Signal}).then(function(r){return r.json();}).catch(function(){return null;});
  }
  _f5Fetch(_primary).then(function(r) {
    if (r && !r.error) return r;
    return _f5Fetch(_fallback);
  }).then(function(target) {
    if (_f5Signal.aborted) { document.getElementById('f5DrawLookupMsg').textContent = ''; return; }
    if (document.getElementById('f5DrawDate').value !== _f5Date) return;
    if (!target || target.error) {
      msg.style.color = 'var(--red)';
      var url = (target && target.resultsUrl) || 'https://floridalottery.com/games/draw-games/fantasy5';
      msg.innerHTML = 'No draw found for that date. <a href="' + url + '" target="_blank" style="color:var(--accent);">View official results</a>';
      return;
    }
    document.getElementById('f5DrawType').value = target.drawType || drawType;
    f5Drawn = target.numbers;
    msg.textContent = '';
    display.style.display = 'block';
    var _isLatest = f5LatestDate && document.getElementById('f5DrawDate').value === f5LatestDate;
    var _ballStyle = _isLatest
      ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)'
      : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
    document.getElementById('f5DrawnBalls').innerHTML = target.numbers.map(function(n) {
      return '<div class="hball" style="' + _ballStyle + ';width:36px;height:36px;font-size:13px;">' + n + '</div>';
    }).join('');
  });
}
function f5CheckNumbers() {
  if (!f5Drawn.length) {
    document.getElementById('f5CheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>'; return;
  }
  var drawn = f5Drawn;
  var f5LineRows = document.querySelectorAll('#f5LinesInputs .line-input-row');
  var f5AllLines = [];
  for (var r = 0; r < f5LineRows.length; r++) {
    var rowInputs = f5LineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 36) {
        document.getElementById('f5CheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Please enter all 5 numbers for Line ' + (r+1) + ' (1-36).</div>'; return;
      }
      line.push(lv);
    }
    f5AllLines.push(line);
  }
  var drawnSet = {};
  drawn.forEach(function(n) { drawnSet[n] = true; });
  document.querySelectorAll('#f5LinesInputs .num-input').forEach(function(inp) {
    var v = parseInt(inp.value);
    inp.className = 'num-input' + (drawnSet[v] ? ' matched' : '');
  });
  var f5ResultEl = document.getElementById('f5CheckResult');
  f5ResultEl.innerHTML = '';
  var f5AllResults = [];
  var f5TotalWinAcc = 0;
  var f5Pending = f5AllLines.length;
  f5AllLines.forEach(function(lineNums, lineIdx) {
    var _acF5C = new AbortController(); setTimeout(function(){_acF5C.abort();}, 15000);
    fetch('/check/fantasy5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drawn: drawn, line: lineNums }), signal: _acF5C.signal })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.error) { f5ResultEl.innerHTML = '<div style="color:var(--red);">' + data.error + '</div>'; return; }
        f5AllResults[lineIdx] = data;
        f5TotalWinAcc += data.isFree ? 0 : (data.prize || 0);
        f5Pending--;
        if (f5Pending > 0) return;
        var html = '';
        f5AllResults.forEach(function(d, idx) {
          var matchedNums = d.matched.join(', ') || 'none';
          var isWinner = d.isJackpot || d.isFree || d.prize > 0;
          var prizeColor = d.isJackpot ? 'var(--yellow)' : (isWinner ? 'var(--green)' : 'var(--muted)');
          var label = f5AllResults.length > 1 ? 'Line ' + (idx+1) : 'Your Line';
          html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '">';
          html += '<span style="font-weight:700;">' + label + '</span> &mdash; ' + d.count + ' match' + (d.count !== 1 ? 'es' : '') + ' (' + matchedNums + ')';
          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
        });
        var anyJackpot = f5AllResults.some(function(d) { return d.isJackpot; });
        var anyFree = f5AllResults.some(function(d) { return d.isFree; }) && f5TotalWinAcc === 0;
        var totalLabel = anyJackpot ? 'JACKPOT!' : (f5TotalWinAcc > 0 ? 'Estimated Winnings' : (anyFree ? 'Free Quick Pick' : 'No Prize This Draw'));
        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));
        f5LastWin = f5TotalWinAcc;
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (f5TotalWinAcc > 0 || anyJackpot ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div>';
        if (f5AllResults.length > 1) html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Total across ' + f5AllResults.length + ' lines. Prizes are pari-mutuel estimates.</div>';
        else html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Prizes are pari-mutuel estimates and vary by number of winners.</div>';
        html += '</div>';
        f5ResultEl.innerHTML = html;
      })
      .catch(function(err) { f5ResultEl.innerHTML = '<div style="color:var(--red);">Error: ' + err.message + '</div>'; });
  });
}

function f5AppendMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  var msgs = document.getElementById('f5ChatMessages');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function f5SendChat() {
  var input = document.getElementById('f5ChatInput');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  var btn = document.getElementById('f5ChatSend');
  btn.disabled = true;
  f5AppendMsg('user', msg);
  var thinking = f5AppendMsg('thinking', 'Thinking...');
  var f5Tickets = f5LastLines ? f5LastLines.length : 0;
  var ez = document.getElementById('f5EZMatchGen') && document.getElementById('f5EZMatchGen').checked;
  var f5Spend = f5Tickets * (ez ? 2 : 1);
  var f5Ctx = f5Tickets > 0 ? { spend: f5Spend, lines: f5Tickets, game: 'fantasy5', won: f5LastWin } : null;
  var _acF5Chat = new AbortController(); setTimeout(function(){_acF5Chat.abort();}, 15000);
  fetch('/chat/fantasy5', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, context: f5Ctx }), signal: _acF5Chat.signal })
    .then(function(res) { return res.json(); })
    .then(function(data) { thinking.remove(); f5AppendMsg('bot', data.reply || data.error || 'No response.'); })
    .catch(function() { thinking.remove(); f5AppendMsg('bot', 'Error reaching server.'); })
    .finally(function() { btn.disabled = false; input.focus(); });
}

function f5QuickAsk(q) { document.getElementById('f5ChatInput').value = q; f5SendChat(); }

function renderDateChips(containerId, dates, pickFn) {
  var el = document.getElementById(containerId);
  if (!el || !dates.length) return;
  el.innerHTML = dates.map(function(d) {
    var parts = d.split('/');
    var label = parts[0] + '/' + parts[1];
    return '<span onclick="' + pickFn + '(\'' + d + '\')" style="cursor:pointer;background:rgba(79,142,247,0.12);border:1px solid rgba(79,142,247,0.3);color:var(--accent);padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;">' + label + '</span>';
  }).join('');
}
function jtpPickDate(d){var p=d.split('/');document.getElementById('jtpDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');jtpLookupDraw();}
function lxPickDate(d){var p=d.split('/');document.getElementById('lxDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');lxLookupDraw();}
function f5PickDate(d){var p=d.split('/');document.getElementById('f5DrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');f5LookupDraw();}
function cpPickDate(d){var p=d.split('/');document.getElementById('cpDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');cpLookupDraw();}
fetch('/draws/jtp/available').then(function(r){return r.json();}).then(function(d){renderDateChips('jtpDateChips',d.dates,'jtpPickDate');}).catch(function(){});
fetch('/draws/lottox/available').then(function(r){return r.json();}).then(function(d){renderDateChips('lxDateChips',d.dates,'lxPickDate');}).catch(function(){});
fetch('/draws/fantasy5/available').then(function(r){return r.json();}).then(function(d){renderDateChips('f5DateChips',d.dates,'f5PickDate');}).catch(function(){});
fetch('/draws/cashpop/available').then(function(r){return r.json();}).then(function(d){
  renderDateChips('cpDateChips',d.dates,'cpPickDate');
  if (!cpLatestDate && d.dates && d.dates.length) {
    var p=d.dates[0].split('/'); var yr=parseInt(p[2]); if(yr<100)yr+=2000;
    cpLatestDate=yr+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
  }
}).catch(function(){});

setInterval(function() {
  fetch('/nextdraw').then(function(r){return r.json();}).then(function(d){startCountdown({nextDraw:d});}).catch(function(){});
  fetch('/nextdraw/lottox').then(function(r){return r.json();}).then(function(d){lxStartCountdown({nextDraw:d});}).catch(function(){});
  fetch('/nextdraw/cashpop').then(function(r){return r.json();}).then(function(d){cpStartCountdown(d);}).catch(function(){});
  fetch('/nextdraw/fantasy5').then(function(r){return r.json();}).then(function(d){f5StartCountdown(d);}).catch(function(){});
  fetch('/nextdraw/megamillions').then(function(r){return r.json();}).then(function(d){mmStartCountdown(d);}).catch(function(){});
}, 60000);

// Auto-populate latest winning numbers on page load
function mmddyyToInputDate(d) {
  var p = d.split('/');
  var yr = parseInt(p[2]); if (yr < 100) yr += 2000;
  return yr + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
}

fetch('/latestdraw/jtp').then(function(r){return r.json();}).then(function(d){
  if (d.error) return;
  jtpDrawn = d.numbers;
  jtpLatestDate = mmddyyToInputDate(d.date);
  document.getElementById('jtpDrawDate').value = jtpLatestDate;
  document.getElementById('jtpDrawnDisplay').style.display = 'block';
  document.getElementById('jtpDrawnBalls').innerHTML = d.numbers.map(function(n){
    return '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;">' + n + '</div>';
  }).join('');
}).catch(function(){});

fetch('/latestdraw/lottox').then(function(r){return r.json();}).then(function(d){
  if (d.error) return;
  lxDrawn = d.numbers;
  lxLatestDate = mmddyyToInputDate(d.date);
  document.getElementById('lxDrawDate').value = lxLatestDate;
  document.getElementById('lxDrawnDisplay').style.display = 'block';
  document.getElementById('lxDrawnBalls').innerHTML = d.numbers.map(function(n){
    return '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;">' + n + '</div>';
  }).join('');
}).catch(function(){});

fetch('/latestdraw/fantasy5').then(function(r){return r.json();}).then(function(d){
  if (d.error) return;
  var latest = d.evening || d.midday;
  if (!latest) return;
  f5Drawn = latest.numbers;
  f5LatestDate = mmddyyToInputDate(latest.date);
  document.getElementById('f5DrawDate').value = f5LatestDate;
  document.getElementById('f5DrawType').value = d.evening ? 'EVENING' : 'MIDDAY';
  document.getElementById('f5DrawnDisplay').style.display = 'block';
  document.getElementById('f5DrawnBalls').innerHTML = latest.numbers.map(function(n){
    return '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;">' + n + '</div>';
  }).join('');
}).catch(function(){});

fetch('/latestdraw/cashpop').then(function(r){return r.json();}).then(function(d){
  if (d.error) return;
  var p=d.date.split('/'); var yr=parseInt(p[2]); if(yr<100)yr+=2000;
  cpLatestDate=yr+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
  document.getElementById('cpDrawDate').value=cpLatestDate;
  cpLookupDraw(true);
}).catch(function(){});

// Fetch live jackpot amounts for JTP, Lotto X, Fantasy 5
(function() {
  var games = ['jtp', 'lottox', 'fantasy5', 'powerball', 'megamillions'];
  var ids = { jtp: 'jtpJackpotAmount', lottox: 'lxJackpotAmount', fantasy5: 'f5JackpotAmount', powerball: 'pbJackpotAmount', megamillions: 'mmJackpotAmount' };
  games.forEach(function(g) {
    fetch('/jackpot?game=' + g).then(function(r){return r.json();}).then(function(d){
      var el = document.getElementById(ids[g]);
      if (el && d.amount) el.textContent = d.amount;
      else if (el) el.textContent = 'See FL Lottery';
    }).catch(function(){});
  });
})();

// == PICK Daily Games ===========================================================
var pickGame = 'pick5';
var pickLastLines = null;
var pickLastNextDraw = null;
var pickLastWin = null;
var pickLatestDate = null;
var pickLatestDrawType = null;
var pickDrawn = [];
var pickFireballDrawn = null;
var pickCountdownInterval = null;

var PICK_DIGITS = { pick2:2, pick3:3, pick4:4, pick5:5 };
var PICK_LABELS = { pick2:'Pick 2', pick3:'Pick 3', pick4:'Pick 4', pick5:'Pick 5' };
var PICK_ICONS  = { pick2:'&#9996;&#65039;', pick3:'&#128290;', pick4:'&#127919;', pick5:'&#127922;' };
var PICK_DESCS  = {
  pick2: 'AI-powered positional frequency analysis on the complete official Florida Lottery draw history. Pick 2 digits (0&ndash;9) for 50&cent; or $1 &mdash; <strong style="color:var(--text);">two draws every day</strong>: Midday (1:05 PM) &amp; Evening (11:15 PM) ET (Florida local time). Add Fireball for extra winning combinations!',
  pick3: 'AI-powered positional frequency analysis on the complete official Florida Lottery draw history. Pick 3 digits (0&ndash;9) for 50&cent; or $1 &mdash; <strong style="color:var(--text);">two draws every day</strong>: Midday (1:05 PM) &amp; Evening (11:15 PM) ET (Florida local time). Add Fireball for extra winning combinations!',
  pick4: 'AI-powered positional frequency analysis on the complete official Florida Lottery draw history. Pick 4 digits (0&ndash;9) for 50&cent; or $1 &mdash; <strong style="color:var(--text);">two draws every day</strong>: Midday (1:05 PM) &amp; Evening (11:15 PM) ET (Florida local time). Add Fireball for extra winning combinations!',
  pick5: 'AI-powered positional frequency analysis on the complete official Florida Lottery draw history. Pick 5 digits (0&ndash;9) for 50&cent; or $1 &mdash; <strong style="color:var(--text);">two draws every day</strong>: Midday (1:05 PM) &amp; Evening (11:15 PM) ET (Florida local time). Add Fireball for extra winning combinations!'
};
var PICK_LINKS  = {
  pick2: 'https://floridalottery.com/games/draw-games/pick-2',
  pick3: 'https://floridalottery.com/games/draw-games/pick-3',
  pick4: 'https://floridalottery.com/games/draw-games/pick-4',
  pick5: 'https://floridalottery.com/games/draw-games/pick-5'
};

function pickSetGame(g, skipTabSync) {
  pickGame = g;
  var n = PICK_DIGITS[g];
  // Update header
  document.getElementById('pickHeaderIcon').innerHTML = PICK_ICONS[g];
  document.getElementById('pickHeaderTitle').textContent = PICK_LABELS[g];
  document.getElementById('pickHeaderDesc').innerHTML = PICK_DESCS[g];
  document.getElementById('pickLotteryLink').href = PICK_LINKS[g];
  ['pick2','pick3','pick4','pick5'].forEach(function(x) {
    var btn = document.getElementById('pickBtn'+x.replace('pick',''));
    if (x === g) { btn.style.background='rgba(99,91,255,0.25)'; btn.style.border='1px solid rgba(99,91,255,0.8)'; btn.style.color='#fff'; btn.style.fontWeight='700'; }
    else { btn.style.background='rgba(99,91,255,0.08)'; btn.style.border='1px solid rgba(99,91,255,0.4)'; btn.style.color='var(--text)'; btn.style.fontWeight='600'; }
  });
  // Sync tab bar to the active Pick game
  if (!skipTabSync) {
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
    document.querySelectorAll('.tab').forEach(function(t){
      if (t.getAttribute('onclick')==="switchTab('"+g+"')") t.classList.add('active');
    });
  }
  // Rebuild check inputs
  var ci = document.getElementById('pickCheckInputs');
  ci.innerHTML = '';
  for (var i=0;i<n;i++) { var inp=document.createElement('input'); inp.className='num-input'; inp.placeholder='#'+(i+1); inp.maxLength=1; inp.style.width='44px'; ci.appendChild(inp); }
  // Reset results
  document.getElementById('pickResults').style.display='none';
  document.getElementById('pickCheckResult').innerHTML='';
  document.getElementById('pickDrawnDisplay').style.display='none';
  document.getElementById('pickDrawnBalls').innerHTML='';
  pickDrawn=[];
  pickFireballDrawn=null;
  pickLastLines=null;
  pickLastWin=null;
  document.getElementById('pickEmailCard').style.display='none';
  document.getElementById('pickDateChips').innerHTML = '';
  pickUpdateCost();
  // Load latest draw for this game
  pickLoadLatest();
  (function(_g){fetch('/draws/pick/available?game='+_g).then(function(r){return r.json();}).then(function(d){if(pickGame===_g)pickRenderChips(d.dates);}).catch(function(){});})(g);
}

function pickUpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('pickLineCount').value)||6,1),100);
  var pa = parseFloat(document.getElementById('pickPlayAmount').value);
  var pt = document.getElementById('pickPlayType').value;
  var fb = document.getElementById('pickFireball').checked;
  var breakdown, total;
  if (pt === 'combo') {
    // Combo: cost = $1 x number of combinations per line (Fireball not available with Combo)
    // Typical cost uses minimum ways (most repeated digits); max is all-different digits
    var comboTypical = { pick2:2, pick3:3, pick4:4, pick5:5 };
    var comboMax     = { pick2:2, pick3:6, pick4:24, pick5:120 };
    var typ = comboTypical[pickGame] || 2;
    var max = comboMax[pickGame] || 2;
    var typCost = count * typ;
    var maxCost = count * max;
    breakdown = count + ' line(s) x Combo -- $' + typ + '/line (min) to $' + max + '/line (max, all-diff digits)';
    total = typ === max ? 'Total: $' + typCost.toFixed(2) : 'Est. $' + typCost.toFixed(2) + '-$' + maxCost.toFixed(2);
  } else {
    var cost = count * pa * (fb ? 2 : 1);
    breakdown = count + ' line(s) x $' + pa.toFixed(2) + (fb ? ' x 2 (Fireball)' : '');
    total = 'Total: $' + cost.toFixed(2);
  }
  document.getElementById('pickCostBreakdown').textContent = breakdown;
  document.getElementById('pickCostTotal').textContent = total;
}

function pickStartCountdown(nd) {
  if (pickCountdownInterval) clearInterval(pickCountdownInterval);
  if (!nd) return;
  pickLastNextDraw = nd;
  document.getElementById('pickDrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('pickDrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('pickDrawName').textContent = nd.drawName || '';
  document.getElementById('pickCloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  var badge = document.getElementById('pickSalesBadge');
  function tick() {
    var ms = nd.msUntilDraw - (Date.now() - _pickCountdownStart);
    if (ms < 0) ms = 0;
    var h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000),s=Math.floor((ms%60000)/1000);
    document.getElementById('pickCountdown').textContent = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
    badge.className = 'sales-badge ' + (nd.salesOpen ? 'open' : 'closed');
  }
  var _pickCountdownStart = Date.now();
  tick();
  pickCountdownInterval = setInterval(tick, 1000);
}

function pickLoadLatest() {
  if (window._pickLatestAC) window._pickLatestAC.abort('game-switch');
  window._pickLatestAC = new AbortController();
  var _ac = window._pickLatestAC;
  setTimeout(function(){_ac.abort();},30000);
  var _game = pickGame;
  fetch('/latestdraw/pick?game='+_game, {signal:_ac.signal}).then(function(r){return r.json();}).then(function(d){
    if (pickGame !== _game) return;
    if (d.error) return;
    var latest = d.evening || d.midday;
    if (!latest) return;
    var p = latest.date.split('/');
    var yr = parseInt(p[2]); if(yr<100)yr+=2000;
    pickLatestDate = yr+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');
    pickLatestDrawType = d.evening ? 'EVENING' : 'MIDDAY';
    document.getElementById('pickDrawDate').value = pickLatestDate;
    document.getElementById('pickDrawType').value = pickLatestDrawType;
    pickDrawn = latest.digits;
    pickFireballDrawn = latest.fireball;
    pickRenderDrawnBalls(latest.digits, latest.fireball, true);
  }).catch(function(){});
}

function pickRenderDrawnBalls(digits, fb, isLatest) {
  var style = isLatest
    ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)'
    : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
  document.getElementById('pickDrawnBalls').innerHTML = digits.map(function(d){
    return '<div class="hball" style="'+style+';width:36px;height:36px;font-size:15px;">'+d+'</div>';
  }).join('');
  var fbEl = document.getElementById('pickFireballDrawn');
  if (fb !== null && fb !== undefined) {
    fbEl.textContent = 'FB: '+fb;
    fbEl.style.display='';
  } else { fbEl.style.display='none'; }
  document.getElementById('pickDrawnDisplay').style.display='block';
}

function pickLookupDraw() {
  var dateVal = document.getElementById('pickDrawDate').value;
  var drawType = document.getElementById('pickDrawType').value;
  var msg = document.getElementById('pickDrawLookupMsg');
  pickDrawn=[];
  pickFireballDrawn=null;
  document.getElementById('pickDrawnDisplay').style.display='none';
  document.getElementById('pickDrawnBalls').innerHTML='';
  if (!dateVal) { msg.textContent=''; return; }
  var parts = dateVal.split('-');
  var mmddyyyy = parts[1]+'/'+parts[2]+'/'+parts[0];
  msg.style.color='var(--muted)'; msg.textContent='Looking up...';
  var _primary = drawType; var _fallback = drawType==='EVENING'?'MIDDAY':'EVENING';
  var _game = pickGame; var _date = dateVal;
  if (window._pickLookupAC) window._pickLookupAC.abort('new-lookup');
  window._pickLookupAC = new AbortController();
  var _pickSignal = window._pickLookupAC.signal;
  setTimeout(function(){if(window._pickLookupAC)window._pickLookupAC.abort('timeout');},60000);
  function _pFetch(dt) {
    return fetch('/draws/pick?game='+_game+'&date='+encodeURIComponent(mmddyyyy)+'&draw='+dt,{signal:_pickSignal}).then(function(r){return r.json();}).catch(function(){return null;});
  }
  _pFetch(_primary).then(function(r){
    if (r && !r.error) return r;
    return _pFetch(_fallback);
  }).then(function(data){
    if (_pickSignal.aborted) { document.getElementById('pickDrawLookupMsg').textContent = ''; return; }
    if (pickGame !== _game || document.getElementById('pickDrawDate').value !== _date) return;
    if (!data || data.error) {
      msg.style.color='var(--red)';
      var url=(data&&data.resultsUrl)||('https://floridalottery.com/games/draw-games/'+pickGame.replace('pick','pick-'));
      msg.innerHTML='No draw found. <a href="'+url+'" target="_blank" style="color:var(--accent);">View official results</a>';
      return;
    }
    pickDrawn=data.digits;
    pickFireballDrawn=data.fireball;
    msg.textContent='';
    var isLatest = pickLatestDate && document.getElementById('pickDrawDate').value===pickLatestDate;
    pickRenderDrawnBalls(data.digits, data.fireball, isLatest);
    document.getElementById('pickDrawType').value = data.drawType || drawType;
  });
}

function pickRenderChips(dates) {
  var el = document.getElementById('pickDateChips');
  if (!el) return;
  if (!dates || !dates.length) { el.innerHTML = ''; return; }
  el.innerHTML = dates.map(function(d){
    var p=d.split('/'); var label=p[0]+'/'+p[1];
    return '<span onclick="pickPickDate(\''+d+'\')" style="cursor:pointer;background:rgba(79,142,247,0.12);border:1px solid rgba(79,142,247,0.3);color:var(--accent);padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;">'+label+'</span>';
  }).join('');
}

function pickPickDate(d){var p=d.split('/');document.getElementById('pickDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');pickLookupDraw();}

function pickGenerate() {
  var btn = document.getElementById('pickGenBtn');
  btn.disabled=true; btn.textContent='Generating...';
  var count=Math.min(Math.max(parseInt(document.getElementById('pickLineCount').value)||6,1),100);
  var _ac=new AbortController();setTimeout(function(){_ac.abort();},30000);
  fetch('/analyze/pick?game='+pickGame+'&count='+count+'&sid='+SID,{signal:_ac.signal})
    .then(function(res){return res.json().then(function(data){return{ok:res.ok,data:data};});})
    .then(function(r){
      if (!r.ok) throw new Error(r.data.error||'Server error');
      pickLastLines=r.data.lines;
      pickLastNextDraw=r.data.nextDraw;
      pickStartCountdown(r.data.nextDraw);
      pickRenderLines(r.data);
      document.getElementById('pickResults').style.display='block';
      document.getElementById('pickEmailCard').style.display='block';
      document.getElementById('pickOddsBadge').textContent=r.data.totalDraws+' draws analyzed';
      document.getElementById('pickUpdatedLabel').textContent='Data as of: '+r.data.lastUpdated;
      pickRenderHistory(r.data.recentHistory);
      pickRenderFreq(r.data.posFreq, r.data.numDigits);
      var el=document.getElementById('pickStatusMsg'); el.style.display='none';
    })
    .catch(function(err){
      var el=document.getElementById('pickStatusMsg');
      el.className='status-msg error'; el.textContent='Error: '+err.message; el.style.display='block';
    })
    .finally(function(){btn.disabled=false;btn.innerHTML=PICK_ICONS[pickGame]+' Generate Lines';});
}

function pickRenderLines(data) {
  var html='';
  data.lines.forEach(function(l,i){
    var color=i===0?'var(--yellow)':'var(--accent)';
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html+='<span style="font-size:11px;color:'+(i===0?'var(--yellow)':'var(--muted)')+';min-width:50px;font-weight:700;">'+(i===0?'BEST:':'Line '+(i+1)+':')+'</span>';
    html+='<div style="display:flex;gap:5px;">';
    l.digits.forEach(function(d){
      html+='<div style="width:36px;height:36px;line-height:36px;text-align:center;border-radius:8px;background:'+color+';color:#000;font-weight:700;font-size:16px;">'+d+'</div>';
    });
    html+='</div><span style="font-size:11px;color:var(--muted);">score:'+l.score+'</span></div>';
  });
  document.getElementById('pickLinesDisplay').innerHTML=html;
}

function pickRenderHistory(history) {
  if (!history||!history.length) return;
  var html='<div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Recent Draws</div>';
  history.slice(0,5).forEach(function(d){
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
    html+='<span style="font-size:11px;color:var(--muted);min-width:70px;">'+d.date+' '+d.drawType.substring(0,3)+'</span>';
    html+='<div style="display:flex;gap:4px;">';
    d.digits.forEach(function(dig){
      html+='<div style="width:28px;height:28px;line-height:28px;text-align:center;border-radius:6px;background:rgba(79,142,247,0.15);color:var(--accent);font-weight:700;font-size:13px;">'+dig+'</div>';
    });
    html+='</div><span style="font-size:11px;color:var(--accent);">FB:'+d.fireball+'</span></div>';
  });
  document.getElementById('pickHistoryDisplay').innerHTML=html;
}

function pickRenderFreq(posFreq, numDigits) {
  if (!posFreq) return;
  var html='<div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Positional Frequency (top 3 per position)</div>';
  html+='<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  posFreq.forEach(function(freq, pos){
    var sorted=freq.map(function(c,d){return{d:d,c:c};}).sort(function(a,b){return b.c-a.c;});
    html+='<div style="background:var(--card);border:1px solid #2a2d3a;border-radius:8px;padding:8px;min-width:60px;">';
    html+='<div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-align:center;">Pos '+(pos+1)+'</div>';
    sorted.slice(0,3).forEach(function(x,i){
      html+='<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:'+(i===0?'var(--yellow)':'var(--text)')+'">'+
        '<span>'+x.d+'</span><span style="color:var(--muted);">'+x.c+'</span></div>';
    });
    html+='</div>';
  });
  html+='</div>';
  document.getElementById('pickFreqDisplay').innerHTML=html;
}

function pickCheckNumbers() {
  if (!pickDrawn.length) {
    document.getElementById('pickCheckResult').innerHTML='<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>'; return;
  }
  var n=PICK_DIGITS[pickGame];
  var inputs=document.getElementById('pickCheckInputs').querySelectorAll('input');
  var played=[];
  for (var i=0;i<inputs.length;i++) {
    var v=parseInt(inputs[i].value.trim());
    if (isNaN(v)||v<0||v>9) { document.getElementById('pickCheckResult').innerHTML='<div style="color:var(--red);font-size:13px;">Enter all '+n+' digits (0-9).</div>'; return; }
    played.push(v);
  }
  var pt=document.getElementById('pickCheckPlayType').value;
  var pa=parseFloat(document.getElementById('pickCheckPlayAmount').value);
  var useFB=document.getElementById('pickCheckFireball').checked;
  var fb=useFB?pickFireballDrawn:null;
  var _ac=new AbortController();setTimeout(function(){_ac.abort();},15000);
  fetch('/check/pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:pickGame,drawn:pickDrawn,fireball:fb,played:played,playType:pt,playAmount:pa}),signal:_ac.signal})
    .then(function(r){return r.json();})
    .then(function(data){
      if (data.error){document.getElementById('pickCheckResult').innerHTML='<div style="color:var(--red);">'+data.error+'</div>';return;}
      var html='';
      if (!data.results.length) {
        html='<div class="check-line-result"><span style="font-weight:700;">No Match</span> &mdash; <span style="color:var(--muted);">$0</span></div>';
      } else {
        data.results.forEach(function(r){
          var color=r.fireball?'var(--accent)':'var(--green)';
          html+='<div class="check-line-result winner"><span style="font-weight:700;">'+r.type+'</span> &mdash; <span style="color:'+color+';font-weight:700;">$'+r.prize.toLocaleString()+'</span></div>';
        });
      }
      if (data.totalPrize>0) {
        pickLastWin=data.takeHome;
        html+='<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Total Prize</div>';
        html+='<div class="amount" style="color:var(--yellow);">$'+data.totalPrize.toLocaleString()+'</div>';
        if (data.withholding>0) html+='<div style="font-size:11px;color:var(--muted);margin-top:4px;">After 24% withholding: ~$'+data.takeHome.toLocaleString()+'</div>';
        html+='</div>';
      } else {
        pickLastWin=0;
        html+='<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">No Prize This Draw</div><div class="amount" style="color:var(--muted);">$0</div></div>';
      }
      document.getElementById('pickCheckResult').innerHTML=html;
      // Highlight matched inputs
      inputs.forEach(function(inp,i){
        inp.className='num-input'+(pickDrawn[i]===played[i]?' matched':'');
      });
    })
    .catch(function(err){document.getElementById('pickCheckResult').innerHTML='<div style="color:var(--red);">Error: '+err.message+'</div>';});
}

function pickClearCheck() {
  document.getElementById('pickCheckInputs').querySelectorAll('input').forEach(function(i){i.value='';i.className='num-input';});
  document.getElementById('pickCheckResult').innerHTML='';
  pickLastWin=null;
}

function pickSendEmail() {
  var to=document.getElementById('pickEmailTo').value.trim();
  if (!to){document.getElementById('pickEmailStatus').textContent='Enter an email address.';return;}
  var incLines=document.getElementById('pickEmailIncLines').checked;
  if (!incLines||!pickLastLines||!pickLastLines.length){document.getElementById('pickEmailStatus').textContent='Generate lines first.';return;}
  var incWinning=document.getElementById('pickEmailIncWinning').checked;
  var btn=document.getElementById('pickEmailBtn');
  btn.disabled=true;
  var lines=pickLastLines.map(function(l,i){return{line:i+1,numbers:l.digits,score:l.score};});
  var _ac=new AbortController();setTimeout(function(){_ac.abort();},30000);
  fetch('/email',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({to:to,lines:lines,nextDraw:pickLastNextDraw,game:'pick',gameLabel:PICK_LABELS[pickGame],
      winningNumbers:incWinning&&pickDrawn.length?pickDrawn:null}),signal:_ac.signal})
    .then(function(r){return r.json();})
    .then(function(data){
      if (data.error){document.getElementById('pickEmailStatus').style.color='var(--red)';document.getElementById('pickEmailStatus').textContent=data.error;}
      else{document.getElementById('pickEmailStatus').style.color='var(--green)';document.getElementById('pickEmailStatus').textContent='Sent to '+data.sent+' recipient'+(data.sent>1?'s':'')+'.';}
    })
    .catch(function(err){document.getElementById('pickEmailStatus').style.color='var(--red)';document.getElementById('pickEmailStatus').textContent='Error: '+err.message;})
    .finally(function(){btn.disabled=false;btn.innerHTML='&#128140; Send Lines';});
}

function pickAppendMsg(role,text){
  var div=document.createElement('div');div.className='chat-msg '+role;div.textContent=text;
  var msgs=document.getElementById('pickChatMessages');msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;
}

function pickSendChat(){
  var input=document.getElementById('pickChatInput');
  var msg=input.value.trim();if(!msg)return;
  input.value='';
  var btn=document.getElementById('pickChatSend');btn.disabled=true;
  pickAppendMsg('user',msg);
  var thinking=pickAppendMsg('thinking','Thinking...');
  var tickets=pickLastLines?pickLastLines.length:0;
  var pa=parseFloat(document.getElementById('pickPlayAmount').value)||1;
  var fb=document.getElementById('pickFireball').checked;
  var spend=tickets*pa*(fb?2:1);
  var ctx=tickets>0?{spend:spend,lines:tickets,game:pickGame,won:pickLastWin}:null;
  var _ac=new AbortController();setTimeout(function(){_ac.abort();},15000);
  fetch('/chat/pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,context:ctx}),signal:_ac.signal})
    .then(function(r){return r.json();})
    .then(function(data){thinking.remove();pickAppendMsg('bot',data.reply||data.error||'No response.');})
    .catch(function(){thinking.remove();pickAppendMsg('bot','Error reaching server.');})
    .finally(function(){btn.disabled=false;input.focus();});
}

function pickQuickAsk(q){document.getElementById('pickChatInput').value=q;pickSendChat();}

document.getElementById('pickChatInput').addEventListener('keydown',function(e){if(e.key==='Enter')pickSendChat();});

// Initialize Pick panel
pickSetGame('pick5', true);
fetch('/nextdraw/pick').then(function(r){return r.json();}).then(function(d){pickStartCountdown(d);}).catch(function(){});
fetch('/draws/pick/available?game=pick5').then(function(r){return r.json();}).then(function(d){pickRenderChips(d.dates);}).catch(function(){});

// Add Pick to the 60s poll
setInterval(function(){
  fetch('/nextdraw/pick').then(function(r){return r.json();}).then(function(d){pickStartCountdown(d);}).catch(function(){});
}, 60000);

// == Powerball ==
var pbPressCount = 0;
var pbCountdownInterval = null;
var pbLastLines = null;
var pbLastNextDraw = null;
var pbLastWin = null;
var pbLatestDate = null;
var pbDrawn = [];
var pbPowerballDrawn = null;

fetch('/nextdraw/powerball')
  .then(function(r){return r.json();})
  .then(function(d){pbStartCountdown(d);})
  .catch(function(){});

function pbStartCountdown(nd) {
  document.getElementById('pbDrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('pbDrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('pbCloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  var badge = document.getElementById('pbSalesBadge');
  var banner = document.getElementById('pbDrawBanner');
  badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  badge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (pbCountdownInterval) clearInterval(pbCountdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('pbCountdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('pbCountdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  pbCountdownInterval = setInterval(tick, 1000);
}

function pbRenderLines(lines) {
  var container = document.getElementById('pbLinesContainer');
  pbLastLines = lines;
  document.getElementById('pbEmailCard').style.display = 'block';
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var balls = l.numbers.map(function(n) {
      return '<div class="ball">' + n + '</div>';
    }).join('');
    var pbBall = '<div class="ball" style="background:rgba(239,68,68,0.15);color:var(--red);border-color:rgba(239,68,68,0.4);">' + l.powerball + '</div>';
    html += '<div class="line-card' + (i === 0 ? ' best' : '') + '"><div class="line-label">' + (i === 0 ? 'Best' : 'Line ' + l.line) + '</div><div class="balls">' + balls + '<span style="font-size:10px;color:var(--muted);margin:0 4px;align-self:center;">PB</span>' + pbBall + '</div><div class="score-wrap"><div class="score-label">' + l.score + '</div><div class="score-info" title="Score">?<div class="score-tooltip"><strong>What is this score?</strong>Scored on white ball frequency (40 pts), recency (20 pts), pair co-occurrence (15 pts), low/high balance (5 pts), spread across 1-69 (10 pts). Does NOT predict winners.</div></div></div></div>';
  }
  container.innerHTML = html;
}

function pbRenderHistory(history) {
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = d.numbers.map(function(n){return '<div class="hball">' + n + '</div>';}).join('');
    var pbBall = '<div class="hball" style="background:rgba(239,68,68,0.15);color:var(--red);border-color:rgba(239,68,68,0.3);">PB ' + d.powerball + '</div>';
    html += '<div class="history-row"><div class="history-date">' + d.date + '</div><div class="history-balls">' + balls + pbBall + '</div></div>';
  }
  document.getElementById('pbHistoryContainer').innerHTML = html;
}

function pbRenderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('pbTopTable').innerHTML = rows(top);
  document.getElementById('pbBottomTable').innerHTML = rows(bottom);
}

function pbRenderAll(data) {
  pbStartCountdown(data.nextDraw);
  pbLastNextDraw = data.nextDraw;
  document.getElementById('pbDrawsBadge').textContent = data.totalDraws + ' draws analyzed';
  document.getElementById('pbUpdatedLabel').textContent = 'Data as of: ' + data.lastUpdated;
  pbRenderHistory(data.recentHistory);
  pbRenderFreq(data.topNumbers, data.bottomNumbers);
  document.getElementById('pbResults').style.display = 'block';
}

function pbGenerate() {
  var btn = document.getElementById('pbGenerateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  var el = document.getElementById('pbStatusMsg');
  el.className = 'status-msg'; el.style.display = 'none';
  var count = Math.min(Math.max(parseInt(document.getElementById('pbLineCount').value) || 6, 1), 100);
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 30000);
  fetch('/analyze/powerball?count=' + count + '&sid=' + SID, {signal:_ac.signal})
    .then(function(res){return res.json().then(function(data){return{ok:res.ok,data:data};});})
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      pbPressCount++;
      document.getElementById('pbPressNum').textContent = pbPressCount;
      document.getElementById('pbPressHint').style.display = 'block';
      document.getElementById('pbEmailBlurb').style.display = 'block';
      if (pbPressCount === 1) pbRenderAll(r.data);
      else pbStartCountdown(r.data.nextDraw);
      pbRenderLines(r.data.lines);
    })
    .catch(function(err) {
      el.className = 'status-msg error'; el.textContent = 'Error: ' + err.message; el.style.display = 'block';
    })
    .finally(function() { btn.disabled = false; btn.textContent = '\u26a1 Generate Lines'; });
}

function pbRebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('pbCheckLineCount').value) || 1, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="pbLineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
    html += '<input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2">';
    html += '<span style="font-size:11px;color:var(--muted);margin:0 4px;">PB</span><input class="num-input" placeholder="PB" maxlength="2" style="border-color:rgba(239,68,68,0.4);">';
    html += '</div></div>';
  }
  document.getElementById('pbLinesInputs').innerHTML = html;
}
pbRebuildCheckLines();

function pbLookupDraw() {
  var dateVal = document.getElementById('pbDrawDate').value;
  var msg = document.getElementById('pbDrawLookupMsg');
  var display = document.getElementById('pbDrawnDisplay');
  pbDrawn = []; pbPowerballDrawn = null;
  display.style.display = 'none';
  document.getElementById('pbDrawnBalls').innerHTML = '';
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyyyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)'; msg.textContent = 'Looking up...';
  var _pbDate = dateVal;
  if (window._pbLookupAC) window._pbLookupAC.abort('new-lookup');
  window._pbLookupAC = new AbortController();
  setTimeout(function(){if(window._pbLookupAC)window._pbLookupAC.abort('timeout');}, 60000);
  fetch('/draws/powerball?date=' + encodeURIComponent(mmddyyyy), {signal: window._pbLookupAC.signal})
    .then(function(r){return r.json();})
    .then(function(data) {
      if (document.getElementById('pbDrawDate').value !== _pbDate) return;
      if (data.error) {
        msg.style.color = 'var(--red)'; msg.textContent = data.error;
        if (data.resultsUrl) msg.innerHTML = data.error + ' <a href="' + data.resultsUrl + '" target="_blank" style="color:var(--accent);">View official results</a>';
        return;
      }
      pbDrawn = data.numbers; pbPowerballDrawn = data.powerball;
      msg.textContent = '';
      display.style.display = 'block';
      var isLatest = pbLatestDate && document.getElementById('pbDrawDate').value === pbLatestDate;
      var ballStyle = isLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
      var pbBallStyle = isLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(239,68,68,0.15);color:var(--red);border-color:rgba(239,68,68,0.4)';
      document.getElementById('pbDrawnBalls').innerHTML =
        data.numbers.map(function(n){return '<div class="hball" style="' + ballStyle + ';width:36px;height:36px;font-size:13px;">' + n + '</div>';}).join('') +
        '<span style="font-size:11px;color:var(--muted);margin:0 6px;">PB</span>' +
        '<div class="hball" style="' + pbBallStyle + ';width:36px;height:36px;font-size:13px;">' + data.powerball + '</div>';
    })
    .catch(function(e){if(e&&e.name==='AbortError'){msg.textContent='';return;} msg.style.color='var(--red)';msg.textContent='Lookup failed.';});
}

function pbCheckNumbers() {
  if (!pbDrawn.length || pbPowerballDrawn === null) {
    document.getElementById('pbCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>'; return;
  }
  var lineRows = document.querySelectorAll('#pbLinesInputs .line-input-row');
  var allResults = []; var totalWin = 0; var pending = lineRows.length;
  var resultEl = document.getElementById('pbCheckResult');
  resultEl.innerHTML = '';
  var pp = parseInt(document.getElementById('pbPowerPlayCheck').value) || 0;
  for (var r = 0; r < lineRows.length; r++) {
    var inputs = lineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < 5; j++) {
      var v = parseInt(inputs[j].value.trim());
      if (isNaN(v) || v < 1 || v > 69) { resultEl.innerHTML = '<div style="color:var(--red);font-size:13px;">Enter all 5 white numbers (1-69) for Line ' + (r+1) + '.</div>'; return; }
      line.push(v);
    }
    var pbPlayed = parseInt(inputs[5].value.trim());
    if (isNaN(pbPlayed) || pbPlayed < 1 || pbPlayed > 26) { resultEl.innerHTML = '<div style="color:var(--red);font-size:13px;">Enter Powerball (1-26) for Line ' + (r+1) + '.</div>'; return; }
    (function(lineNums, pbP, idx) {
      var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 15000);
      fetch('/check/powerball', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({drawn:pbDrawn,powerballDrawn:pbPowerballDrawn,line:lineNums,powerballPlayed:pbP,powerPlay:pp}),signal:_ac.signal})
        .then(function(res){return res.json();})
        .then(function(data) {
          allResults[idx] = data;
          totalWin += data.prize || 0;
          pending--;
          if (pending > 0) return;
          var html = '';
          allResults.forEach(function(d, i) {
            var isWin = d.isJackpot || d.prize > 0;
            var color = d.isJackpot ? 'var(--yellow)' : (isWin ? 'var(--green)' : 'var(--muted)');
            var label = allResults.length > 1 ? 'Line ' + (i+1) : 'Your Line';
            html += '<div class="check-line-result' + (isWin ? ' winner' : '') + '"><span style="font-weight:700;">' + label + '</span> &mdash; ' + d.whiteCount + ' white match' + (d.whiteCount!==1?'es':'') + (d.pbMatch?' + PB':'') + ' &mdash; <span style="color:' + color + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
          });
          pbLastWin = totalWin;
          var totalLabel = totalWin > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
          html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (totalWin>0?'var(--yellow)':'var(--muted)') + ';">' + (totalWin>0?'approx $'+totalWin.toLocaleString():'$0') + '</div></div>';
          resultEl.innerHTML = html;
        })
        .catch(function(err){resultEl.innerHTML='<div style="color:var(--red);">Error: '+err.message+'</div>';});
    })(line, pbPlayed, r);
  }
}

function pbClearCheck() {
  document.getElementById('pbCheckLineCount').value = '1';
  pbRebuildCheckLines();
  document.getElementById('pbPowerPlayCheck').value = '0';
  document.getElementById('pbCheckResult').innerHTML = '';
  document.getElementById('pbDrawDate').value = '';
  document.getElementById('pbDrawnDisplay').style.display = 'none';
  document.getElementById('pbDrawnBalls').innerHTML = '';
  document.getElementById('pbDrawLookupMsg').textContent = '';
  pbDrawn = []; pbPowerballDrawn = null; pbLastWin = null;
}

function pbAppendMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + role; div.textContent = text;
  var msgs = document.getElementById('pbChatMessages');
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight; return div;
}

function pbSendChat() {
  var input = document.getElementById('pbChatInput');
  var msg = input.value.trim(); if (!msg) return;
  input.value = '';
  var btn = document.getElementById('pbChatSend'); btn.disabled = true;
  pbAppendMsg('user', msg);
  var thinking = pbAppendMsg('thinking', 'Thinking...');
  var tickets = pbLastLines ? pbLastLines.length : 0;
  var pp = document.getElementById('pbPowerPlay').checked;
  var dp = document.getElementById('pbDoublePlay').checked;
  var spend = tickets * (2 + (pp?1:0) + (dp?1:0));
  var ctx = tickets > 0 ? { spend: spend, lines: tickets, game: 'powerball', won: pbLastWin } : null;
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 15000);
  fetch('/chat/powerball', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,context:ctx}),signal:_ac.signal})
    .then(function(r){return r.json();})
    .then(function(data){thinking.remove();pbAppendMsg('bot',data.reply||data.error||'No response.');})
    .catch(function(){thinking.remove();pbAppendMsg('bot','Error reaching server.');})
    .finally(function(){btn.disabled=false;input.focus();});
}

function pbSendEmail() {
  var to = document.getElementById('pbEmailTo').value.trim();
  if (!to) { document.getElementById('pbEmailStatus').style.color='var(--red)'; document.getElementById('pbEmailStatus').textContent='Please enter at least one email address.'; return; }
  var incLines = document.getElementById('pbEmailIncLines').checked && pbLastLines && pbLastLines.length > 0;
  var incWinning = document.getElementById('pbEmailIncWinning').checked && pbDrawn.length > 0;
  if (!incLines) { document.getElementById('pbEmailStatus').style.color='var(--red)'; document.getElementById('pbEmailStatus').textContent='Generate lines first before sending.'; return; }
  var btn = document.getElementById('pbEmailSendBtn'); btn.disabled = true; btn.textContent = 'Sending...';
  document.getElementById('pbEmailStatus').textContent = '';
  var lines = pbLastLines.map(function(l,i){return{line:i+1,numbers:l.numbers.concat([l.powerball]),score:l.score};});
  var winNums = incWinning ? pbDrawn.concat([pbPowerballDrawn]) : null;
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 30000);
  fetch('/email', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({to:to,lines:lines,nextDraw:pbLastNextDraw,game:'powerball',winningNumbers:winNums,winDrawDate:incWinning?document.getElementById('pbDrawDate').value:null,winPrize:(incWinning&&pbLastWin!=null)?pbLastWin:null}),signal:_ac.signal})
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){document.getElementById('pbEmailStatus').style.color='var(--red)';document.getElementById('pbEmailStatus').textContent=data.error;}
      else{document.getElementById('pbEmailStatus').style.color='var(--green)';document.getElementById('pbEmailStatus').textContent='Sent to '+data.sent+' recipient'+(data.sent>1?'s':'')+'.';}
    })
    .catch(function(err){document.getElementById('pbEmailStatus').style.color='var(--red)';document.getElementById('pbEmailStatus').textContent='Error: '+err.message;})
    .finally(function(){btn.disabled=false;btn.innerHTML='&#128140; Send Lines';});
}

function pbQuickAsk(q){document.getElementById('pbChatInput').value=q;pbSendChat();}
document.getElementById('pbChatInput').addEventListener('keydown',function(e){if(e.key==='Enter')pbSendChat();});

function pbPickDate(d){var p=d.split('/');document.getElementById('pbDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');pbLookupDraw();}
fetch('/draws/powerball/available').then(function(r){return r.json();}).then(function(d){renderDateChips('pbDateChips',d.dates,'pbPickDate');}).catch(function(){});

// == Mega Millions ==
var mmPressCount = 0;
var mmCountdownInterval = null;
var mmLastLines = null;
var mmLastNextDraw = null;
var mmLastWin = null;
var mmLatestDate = null;
var mmDrawn = [];
var mmMegaballDrawn = null;

fetch('/nextdraw/megamillions')
  .then(function(r){return r.json();})
  .then(function(d){mmStartCountdown(d);})
  .catch(function(){});

function mmStartCountdown(nd) {
  document.getElementById('mmDrawWhen').textContent = nd.dayName + ', ' + nd.date;
  document.getElementById('mmDrawTimeLabel').textContent = 'Draw at ' + nd.drawTime;
  document.getElementById('mmCloseTimeLabel').textContent = 'Sales close ' + nd.closeTime;
  var badge = document.getElementById('mmSalesBadge');
  var banner = document.getElementById('mmDrawBanner');
  badge.textContent = nd.salesOpen ? 'Sales Open' : 'Sales Closed';
  badge.className = 'sales-badge' + (nd.salesOpen ? '' : ' closed');
  banner.className = 'draw-banner' + (nd.salesOpen ? '' : ' sales-closed');
  if (mmCountdownInterval) clearInterval(mmCountdownInterval);
  var remaining = nd.msUntilDraw;
  function tick() {
    if (remaining <= 0) { document.getElementById('mmCountdown').textContent = 'Drawing now!'; return; }
    var h = Math.floor(remaining / 3600000);
    var m = Math.floor((remaining % 3600000) / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('mmCountdown').textContent = h > 0 ? (h + 'h ' + String(m).padStart(2,'0') + 'm') : (m + 'm ' + String(s).padStart(2,'0') + 's');
    remaining -= 1000;
  }
  tick();
  mmCountdownInterval = setInterval(tick, 1000);
}

function mmRenderLines(lines) {
  var container = document.getElementById('mmLinesContainer');
  mmLastLines = lines;
  document.getElementById('mmEmailCard').style.display = 'block';
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var balls = l.numbers.map(function(n) { return '<div class="ball">' + n + '</div>'; }).join('');
    var mbBall = '<div class="ball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);">' + l.megaball + '</div>';
    html += '<div class="line-card' + (i === 0 ? ' best' : '') + '"><div class="line-label">' + (i === 0 ? 'Best' : 'Line ' + l.line) + '</div><div class="balls">' + balls + '<span style="font-size:10px;color:var(--muted);margin:0 4px;align-self:center;">MB</span>' + mbBall + '</div><div class="score-wrap"><div class="score-label">' + l.score + '</div><div class="score-info" title="Score">?<div class="score-tooltip"><strong>What is this score?</strong>Scored on white ball frequency (40 pts), recency (20 pts), pair co-occurrence (15 pts), low/high balance (5 pts), spread across 1-70 (10 pts). Does NOT predict winners.</div></div></div></div>';
  }
  container.innerHTML = html;
}

function mmRenderHistory(history) {
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var d = history[i];
    var balls = d.numbers.map(function(n){return '<div class="hball">' + n + '</div>';}).join('');
    var mbBall = '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.3);">MB ' + d.megaball + '</div>';
    html += '<div class="history-row"><div class="history-date">' + d.date + '</div><div class="history-balls">' + balls + mbBall + '</div></div>';
  }
  document.getElementById('mmHistoryContainer').innerHTML = html;
}

function mmRenderFreq(top, bottom) {
  var maxCount = top.length > 0 ? top[0].count : 1;
  function rows(nums) {
    var html = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      var pct = Math.round(n.count / maxCount * 100);
      html += '<tr><td style="color:var(--muted);font-size:11px;">' + (i+1) + '</td><td><span class="num-circle">' + n.number + '</span></td><td><div style="display:flex;align-items:center;gap:6px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span style="color:var(--muted);font-size:11px;min-width:24px;text-align:right;">' + n.count + '</span></div></td></tr>';
    }
    return html;
  }
  document.getElementById('mmTopTable').innerHTML = rows(top);
  document.getElementById('mmBottomTable').innerHTML = rows(bottom);
}

function mmRenderAll(data) {
  mmStartCountdown(data.nextDraw);
  mmLastNextDraw = data.nextDraw;
  document.getElementById('mmDrawsBadge').textContent = data.totalDraws + ' draws analyzed';
  document.getElementById('mmUpdatedLabel').textContent = 'Data as of: ' + data.lastUpdated;
  mmRenderHistory(data.recentHistory);
  mmRenderFreq(data.topNumbers, data.bottomNumbers);
  document.getElementById('mmResults').style.display = 'block';
}

function mmGenerate() {
  var btn = document.getElementById('mmGenerateBtn');
  btn.disabled = true; btn.textContent = 'Generating...';
  var el = document.getElementById('mmStatusMsg');
  el.className = 'status-msg'; el.style.display = 'none';
  var count = Math.min(Math.max(parseInt(document.getElementById('mmLineCount').value) || 6, 1), 100);
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 30000);
  fetch('/analyze/megamillions?count=' + count + '&sid=' + SID, {signal:_ac.signal})
    .then(function(res){return res.json().then(function(data){return{ok:res.ok,data:data};});})
    .then(function(r) {
      if (!r.ok) throw new Error(r.data.error || 'Server error');
      mmPressCount++;
      document.getElementById('mmPressNum').textContent = mmPressCount;
      document.getElementById('mmPressHint').style.display = 'block';
      document.getElementById('mmEmailBlurb').style.display = 'block';
      if (mmPressCount === 1) mmRenderAll(r.data);
      else mmStartCountdown(r.data.nextDraw);
      mmRenderLines(r.data.lines);
    })
    .catch(function(err) {
      el.className = 'status-msg error'; el.textContent = 'Error: ' + err.message; el.style.display = 'block';
    })
    .finally(function() { btn.disabled = false; btn.textContent = '\u{1F4AB} Generate Lines'; });
}

function mmRebuildCheckLines() {
  var count = Math.min(Math.max(parseInt(document.getElementById('mmCheckLineCount').value) || 1, 1), 30);
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="line-input-row" id="mmLineRow' + i + '"><span class="line-row-label">Line ' + (i+1) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
    html += '<input class="num-input" placeholder="#1" maxlength="2"><input class="num-input" placeholder="#2" maxlength="2"><input class="num-input" placeholder="#3" maxlength="2"><input class="num-input" placeholder="#4" maxlength="2"><input class="num-input" placeholder="#5" maxlength="2">';
    html += '<span style="font-size:11px;color:var(--muted);margin:0 4px;">MB</span><input class="num-input" placeholder="MB" maxlength="2" style="border-color:rgba(245,158,11,0.4);">';
    html += '</div></div>';
  }
  document.getElementById('mmLinesInputs').innerHTML = html;
}
mmRebuildCheckLines();

function mmLookupDraw() {
  var dateVal = document.getElementById('mmDrawDate').value;
  var msg = document.getElementById('mmDrawLookupMsg');
  var display = document.getElementById('mmDrawnDisplay');
  mmDrawn = []; mmMegaballDrawn = null;
  display.style.display = 'none';
  document.getElementById('mmDrawnBalls').innerHTML = '';
  if (!dateVal) { msg.textContent = ''; return; }
  var parts = dateVal.split('-');
  var mmddyyyy = parts[1] + '/' + parts[2] + '/' + parts[0];
  msg.style.color = 'var(--muted)'; msg.textContent = 'Looking up...';
  var _mmDate = dateVal;
  if (window._mmLookupAC) window._mmLookupAC.abort('new-lookup');
  window._mmLookupAC = new AbortController(); setTimeout(function(){if(window._mmLookupAC)window._mmLookupAC.abort('timeout');},60000);
  fetch('/draws/megamillions?date=' + encodeURIComponent(mmddyyyy), {signal:window._mmLookupAC.signal})
    .then(function(r){return r.json();})
    .then(function(data) {
      if (document.getElementById('mmDrawDate').value !== _mmDate) return;
      if (data.error) {
        msg.style.color = 'var(--red)'; msg.textContent = data.error;
        if (data.resultsUrl) msg.innerHTML = data.error + ' <a href="' + data.resultsUrl + '" target="_blank" style="color:var(--accent);">View official results</a>';
        return;
      }
      mmDrawn = data.numbers; mmMegaballDrawn = data.megaball;
      msg.textContent = '';
      display.style.display = 'block';
      var isLatest = mmLatestDate && document.getElementById('mmDrawDate').value === mmLatestDate;
      var ballStyle = isLatest ? 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)' : 'background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4)';
      document.getElementById('mmDrawnBalls').innerHTML =
        data.numbers.map(function(n){return '<div class="hball" style="'+ballStyle+';width:36px;height:36px;font-size:13px;">'+n+'</div>';}).join('') +
        '<span style="font-size:11px;color:var(--muted);margin:0 6px;">MB</span>' +
        '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;">' + data.megaball + '</div>';
    })
    .catch(function(e){if(e&&e.name==='AbortError'){msg.textContent='';return;} msg.style.color='var(--red)';msg.textContent='Lookup failed.';});
}

function mmCheckNumbers() {
  if (!mmDrawn.length) {
    document.getElementById('mmCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Select a draw date first.</div>'; return;
  }
  var lineRows = document.querySelectorAll('#mmLinesInputs .line-input-row');
  var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var line = [], mbVal = null;
    for (var j = 0; j < rowInputs.length - 1; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 70) {
        document.getElementById('mmCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Enter all 5 white ball numbers (1-70) for Line ' + (r+1) + '.</div>'; return;
      }
      line.push(lv);
    }
    mbVal = parseInt(rowInputs[rowInputs.length-1].value.trim());
    if (isNaN(mbVal) || mbVal < 1 || mbVal > 25) {
      document.getElementById('mmCheckResult').innerHTML = '<div style="color:var(--red);font-size:13px;">Enter Mega Ball (1-25) for Line ' + (r+1) + '.</div>'; return;
    }
    allLines.push({ line: line, mb: mbVal });
  }
  var mp = parseInt(document.getElementById('mmMegaplierCheck').value) || 0;
  var drawnSet = {}; mmDrawn.forEach(function(n){drawnSet[n]=true;});
  document.querySelectorAll('#mmLinesInputs .num-input').forEach(function(inp, idx) {
    var v = parseInt(inp.value);
    inp.className = 'num-input' + (drawnSet[v] ? ' matched' : '');
  });
  var resultEl = document.getElementById('mmCheckResult');
  resultEl.innerHTML = '';
  var allResults = [], totalWin = 0, pending = allLines.length;
  allLines.forEach(function(entry, lineIdx) {
    var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 15000);
    fetch('/check/megamillions', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ drawn: mmDrawn, megaballDrawn: mmMegaballDrawn, line: entry.line, megaballPlayed: entry.mb, megaplier: mp }), signal: _ac.signal })
      .then(function(res){return res.json();})
      .then(function(data) {
        if (data.error) { resultEl.innerHTML = '<div style="color:var(--red);">' + data.error + '</div>'; return; }
        allResults[lineIdx] = data;
        totalWin += data.prize || 0;
        pending--;
        if (pending > 0) return;
        var html = '';
        allResults.forEach(function(d, idx) {
          var isWinner = d.isJackpot || d.prize > 0;
          var prizeColor = d.isJackpot ? 'var(--yellow)' : (isWinner ? 'var(--green)' : 'var(--muted)');
          var label = allResults.length > 1 ? 'Line ' + (idx+1) : 'Your Line';
          html += '<div class="check-line-result' + (isWinner ? ' winner' : '') + '">';
          html += '<span style="font-weight:700;">' + label + '</span> &mdash; ' + d.whiteCount + ' white + ' + (d.mbMatch ? 'MB' : 'no MB') + ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
        });
        mmLastWin = totalWin;
        var totalLabel = totalWin > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
        var totalDisplay = totalWin > 0 ? '$' + totalWin.toLocaleString() : '$0';
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (totalWin > 0 ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div></div>';
        resultEl.innerHTML = html;
      })
      .catch(function(err){resultEl.innerHTML='<div style="color:var(--red);">Error: '+err.message+'</div>';});
  });
}

function mmClearCheck() {
  document.getElementById('mmCheckLineCount').value = '1';
  mmRebuildCheckLines();
  document.getElementById('mmMegaplierCheck').value = '0';
  document.getElementById('mmCheckResult').innerHTML = '';
  document.getElementById('mmDrawDate').value = '';
  document.getElementById('mmDrawnDisplay').style.display = 'none';
  document.getElementById('mmDrawnBalls').innerHTML = '';
  document.getElementById('mmDrawLookupMsg').textContent = '';
  mmDrawn = []; mmMegaballDrawn = null; mmLastWin = null;
}

function mmAppendMsg(role, text) {
  var div = document.createElement('div'); div.className = 'chat-msg ' + role; div.textContent = text;
  var msgs = document.getElementById('mmChatMessages'); msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight; return div;
}

function mmSendChat() {
  var input = document.getElementById('mmChatInput');
  var msg = input.value.trim(); if (!msg) return;
  input.value = '';
  var btn = document.getElementById('mmChatSend'); btn.disabled = true;
  mmAppendMsg('user', msg);
  var thinking = mmAppendMsg('thinking', 'Thinking...');
  var mmTickets = mmLastLines ? mmLastLines.length : 0;
  var mmMP = document.getElementById('mmMegaplier').checked;
  var mmSpend = mmTickets * (2 + (mmMP ? 1 : 0));
  var mmCtx = mmTickets > 0 ? { spend: mmSpend, lines: mmTickets, game: 'megamillions', won: mmLastWin } : null;
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 15000);
  fetch('/chat/megamillions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ message: msg, context: mmCtx }), signal: _ac.signal })
    .then(function(r){return r.json();})
    .then(function(data){thinking.remove();mmAppendMsg('bot',data.reply||data.error||'No response.');})
    .catch(function(){thinking.remove();mmAppendMsg('bot','Error reaching server.');})
    .finally(function(){btn.disabled=false;input.focus();});
}

function mmSendEmail() {
  var to = document.getElementById('mmEmailTo').value.trim();
  if (!to) { document.getElementById('mmEmailStatus').style.color='var(--red)'; document.getElementById('mmEmailStatus').textContent='Please enter at least one email address.'; return; }
  var incLines = document.getElementById('mmEmailIncLines').checked && mmLastLines && mmLastLines.length > 0;
  var incWinning = document.getElementById('mmEmailIncWinning').checked && mmDrawn.length > 0;
  if (!incLines) { document.getElementById('mmEmailStatus').style.color='var(--red)'; document.getElementById('mmEmailStatus').textContent='Generate lines first before sending.'; return; }
  var btn = document.getElementById('mmEmailSendBtn'); btn.disabled = true; btn.textContent = 'Sending...';
  document.getElementById('mmEmailStatus').textContent = '';
  var lines = incLines ? mmLastLines.map(function(l,i){return{line:i+1,numbers:l.numbers.concat([l.megaball]),score:l.score};}) : [];
  var _ac = new AbortController(); setTimeout(function(){_ac.abort();}, 30000);
  fetch('/email', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ to: to, lines: lines, nextDraw: mmLastNextDraw, game: 'megamillions',
      winningNumbers: incWinning ? mmDrawn.concat([mmMegaballDrawn]) : null,
      winDrawDate: incWinning ? document.getElementById('mmDrawDate').value : null, winPrize: (incWinning && mmLastWin != null) ? mmLastWin : null }), signal: _ac.signal })
    .then(function(r){return r.json();})
    .then(function(data){
      if (data.error) { document.getElementById('mmEmailStatus').style.color='var(--red)'; document.getElementById('mmEmailStatus').textContent=data.error; }
      else { document.getElementById('mmEmailStatus').style.color='var(--green)'; document.getElementById('mmEmailStatus').textContent='Sent to '+data.sent+' recipient'+(data.sent>1?'s':'')+'.'; }
    })
    .catch(function(err){document.getElementById('mmEmailStatus').style.color='var(--red)';document.getElementById('mmEmailStatus').textContent='Error: '+err.message;})
    .finally(function(){btn.disabled=false;btn.innerHTML='&#128140; Send Lines';});
}

function mmUpdateCost() {
  var count = Math.min(Math.max(parseInt(document.getElementById('mmLineCount').value) || 6, 1), 100);
  var mp = document.getElementById('mmMegaplier').checked;
  var base = count * 2;
  var mpAmt = mp ? count * 1 : 0;
  var total = base + mpAmt;
  var parts = count + ' play' + (count !== 1 ? 's' : '') + ' x $2 = $' + base;
  if (mp) parts += '  +  Megaplier ' + count + ' x $1 = $' + mpAmt;
  document.getElementById('mmCostBreakdown').textContent = parts;
  document.getElementById('mmCostTotal').textContent = 'Total: $' + total;
}

function mmQuickAsk(q){document.getElementById('mmChatInput').value=q;mmSendChat();}
document.getElementById('mmChatInput').addEventListener('keydown',function(e){if(e.key==='Enter')mmSendChat();});

function mmPickDate(d){var p=d.split('/');document.getElementById('mmDrawDate').value=p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0');mmLookupDraw();}
fetch('/draws/megamillions/available').then(function(r){return r.json();}).then(function(d){renderDateChips('mmDateChips',d.dates,'mmPickDate');}).catch(function(){});

fetch('/latestdraw/megamillions').then(function(r){return r.json();}).then(function(d){
  if (d.error) return;
  mmDrawn = d.numbers; mmMegaballDrawn = d.megaball;
  mmLatestDate = mmddyyToInputDate(d.date);
  document.getElementById('mmDrawDate').value = mmLatestDate;
  document.getElementById('mmDrawnDisplay').style.display = 'block';
  var ballStyle = 'background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)';
  document.getElementById('mmDrawnBalls').innerHTML =
    d.numbers.map(function(n){return '<div class="hball" style="'+ballStyle+';width:36px;height:36px;font-size:13px;">'+n+'</div>';}).join('') +
    '<span style="font-size:11px;color:var(--muted);margin:0 6px;">MB</span>' +
    '<div class="hball" style="'+ballStyle+';width:36px;height:36px;font-size:13px;">'+d.megaball+'</div>';
}).catch(function(){});

mmUpdateCost();

setInterval(function(){
  fetch('/nextdraw/megamillions').then(function(r){return r.json();}).then(function(d){mmStartCountdown(d);}).catch(function(){});
}, 60000);

fetch('/latestdraw/powerball').then(function(r){return r.json();}).then(function(d){
  if(d.error)return;
  pbDrawn=d.numbers; pbPowerballDrawn=d.powerball;
  pbLatestDate=mmddyyToInputDate(d.date);
  document.getElementById('pbDrawDate').value=pbLatestDate;
  document.getElementById('pbDrawnDisplay').style.display='block';
  var ballStyle='background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4)';
  document.getElementById('pbDrawnBalls').innerHTML=
    d.numbers.map(function(n){return '<div class="hball" style="'+ballStyle+';width:36px;height:36px;font-size:13px;">'+n+'</div>';}).join('')+
    '<span style="font-size:11px;color:var(--muted);margin:0 6px;">PB</span>'+
    '<div class="hball" style="background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;">'+d.powerball+'</div>';
}).catch(function(){});

// Add Powerball to 60s poll
setInterval(function(){
  fetch('/nextdraw/powerball').then(function(r){return r.json();}).then(function(d){pbStartCountdown(d);}).catch(function(){});
}, 60000);

// When switching to powerball tab
function switchTab(id) {
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.game-panel').forEach(function(p){p.classList.remove('active');});
  event.currentTarget.classList.add('active');
  if (id==='pick2'||id==='pick3'||id==='pick4'||id==='pick5') {
    document.getElementById('panel-pick5').classList.add('active');
    pickSetGame(id);
  } else {
    document.getElementById('panel-'+id).classList.add('active');
  }
}


var disclaimerPopup = document.getElementById('disclaimerPopup');
var hideTimer = null;

function showDisclaimer() {
  clearTimeout(hideTimer);
  disclaimerPopup.classList.add('show');
}
function hideDisclaimer() {
  disclaimerPopup.classList.remove('show');
}
function toggleDisclaimer(e) {
  e.preventDefault();
  disclaimerPopup.classList.contains('show') ? hideDisclaimer() : showDisclaimer();
}

// Hide when clicking outside
document.addEventListener('click', function(e) {
  if (!disclaimerPopup.contains(e.target) && e.target.id !== 'disclaimerLink') {
    hideDisclaimer();
  }
});

// Hide on mouse leave (with small delay so user can read)
disclaimerPopup.addEventListener('mouseleave', function() {
  hideTimer = setTimeout(hideDisclaimer, 1500);
});
disclaimerPopup.addEventListener('mouseenter', function() {
  clearTimeout(hideTimer);
});
document.getElementById('disclaimerLink').addEventListener('mouseleave', function() {
  hideTimer = setTimeout(hideDisclaimer, 1500);
});

