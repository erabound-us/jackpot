const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');
console.log('Start size:', src.length);

// Use function form of replace to avoid $ special chars in replacement string
const f5Old = `        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const f5New = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;

if (src.includes(f5Old)) {
  const idx = src.indexOf(f5Old);
  src = src.slice(0, idx) + f5New + src.slice(idx + f5Old.length);
  console.log('F5 fixed, size now:', src.length);
} else {
  console.log('F5 NOT found');
}

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
  const idx = src.indexOf(lxOld);
  src = src.slice(0, idx) + lxNew + src.slice(idx + lxOld.length);
  console.log('LX fixed, size now:', src.length);
} else {
  console.log('LX NOT found');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done. Final file size:', fs.statSync(path).size);
