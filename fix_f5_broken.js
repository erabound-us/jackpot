const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

// Fix the broken F5 totalDisplay line (was truncated by previous script)
const broken = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx \n`;
const fixed  = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));\n`;

if (src.includes(broken)) {
  src = src.replace(broken, fixed);
  console.log('F5 totalDisplay line fixed');
} else {
  // Try to find what's actually there
  const idx = src.indexOf("var totalDisplay = anyJackpot ? f5AllResults");
  if (idx !== -1) {
    console.log('Found at idx', idx, ':', JSON.stringify(src.slice(idx, idx+300)));
  } else {
    console.log('F5 totalDisplay NOT found at all');
  }
}

fs.writeFileSync(path, src);
console.log('Done.');
