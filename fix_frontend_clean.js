const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

// Verify file is clean (single copy)
const count = (src.match(/function f5CheckNumbers/g) || []).length;
console.log('f5CheckNumbers occurrences:', count, '(should be 1)');

// --- F5: fix totalDisplay to use prizeDisplay from jackpot result ---
const f5Old = `        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const f5New = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;

if (src.includes(f5Old)) {
  src = src.replace(f5Old, f5New);
  console.log('F5 totalDisplay fixed');
} else {
  console.log('F5 totalDisplay NOT found - checking what is there:');
  const idx = src.indexOf("var totalDisplay = anyJackpot");
  if (idx !== -1) console.log(JSON.stringify(src.slice(idx, idx+200)));
}

// --- LX: add anyLxJackpot check for totalLabel/totalDisplay ---
const lxOld = `        var totalLabel = lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
        var totalDisplay = lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0';
        lxLastWin = lxTotalWinAcc;
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div>';`;
const lxNew = `        var anyLxJackpot = lxAllResults.some(function(d) { return d.isJackpot; });
        var totalLabel = anyLxJackpot ? 'JACKPOT!' : (lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw');
        var totalDisplay = anyLxJackpot ? lxAllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0');
        lxLastWin = lxTotalWinAcc;
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (anyLxJackpot || lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div>';`;

if (src.includes(lxOld)) {
  src = src.replace(lxOld, lxNew);
  console.log('LX totalDisplay fixed');
} else {
  console.log('LX totalDisplay NOT found');
  const idx = src.indexOf("var totalLabel = lxTotalWinAcc");
  if (idx !== -1) console.log(JSON.stringify(src.slice(idx, idx+300)));
}

fs.writeFileSync(path, src);
console.log('Done. File size:', fs.statSync(path).size);
