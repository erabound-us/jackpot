const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

// --- LX: fix totalLabel/totalDisplay to handle jackpot ---
const lxOld = `        var totalLabel = lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw';\n        var totalDisplay = lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0';\n        lxLastWin = lxTotalWinAcc;\n        html += '<div class=\"check-total\"><div style=\"font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;\">' + totalLabel + '</div><div class=\"amount\" style=\"color:' + (lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';\">' + totalDisplay + '</div>';`;
const lxNew = `        var anyLxJackpot = lxAllResults.some(function(d) { return d.isJackpot; });\n        var totalLabel = anyLxJackpot ? 'JACKPOT!' : (lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw');\n        var totalDisplay = anyLxJackpot ? lxAllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0');\n        lxLastWin = lxTotalWinAcc;\n        html += '<div class=\"check-total\"><div style=\"font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;\">' + totalLabel + '</div><div class=\"amount\" style=\"color:' + (anyLxJackpot || lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';\">' + totalDisplay + '</div>';`;

if (src.includes(lxOld)) {
  src = src.replace(lxOld, lxNew);
  console.log('LX frontend fixed');
} else {
  console.log('LX frontend NOT found');
}

// --- F5: fix totalDisplay to show prizeDisplay from jackpot result ---
// Current: totalDisplay = anyJackpot ? 'JACKPOT' : ...
// Fix: use the prizeDisplay from the jackpot result (which now includes the amount)
const f5Old = `        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const f5New = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;

if (src.includes(f5Old)) {
  src = src.replace(f5Old, f5New);
  console.log('F5 frontend fixed');
} else {
  console.log('F5 frontend NOT found');
}

fs.writeFileSync(path, src);
console.log('Done.');
