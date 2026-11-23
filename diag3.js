const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');
console.log('Start size:', src.length);

// Test F5 replacement only
const f5Old = `        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const f5New = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const afterF5 = src.replace(f5Old, f5New);
console.log('After F5 replace:', afterF5.length, '(delta:', afterF5.length - src.length, ')');

// Test LX replacement only
const lxOld = `        var totalLabel = lxTotalWinAcc > 0 ? 'Estimated Winnings' : 'No Prize This Draw';
        var totalDisplay = lxTotalWinAcc > 0 ? 'approx $' + lxTotalWinAcc.toLocaleString() : '$0';
        lxLastWin = lxTotalWinAcc;
        html += '<div class="check-total"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + totalLabel + '</div><div class="amount" style="color:' + (lxTotalWinAcc > 0 ? 'var(--yellow)' : 'var(--muted)') + ';">' + totalDisplay + '</div>';`;

const idx = src.indexOf(lxOld);
console.log('LX pattern found at idx:', idx);
console.log('LX occurrences:', (src.split(lxOld).length - 1));

if (idx !== -1) {
  const afterLX = src.replace(lxOld, 'REPLACED');
  console.log('After LX replace with REPLACED:', afterLX.length);
}
