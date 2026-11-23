const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
const before = fs.statSync(path).size;
let src = fs.readFileSync(path, 'utf8');
console.log('Read length:', src.length, 'File size before:', before);

// Do one replacement
const old = `        var totalDisplay = anyJackpot ? 'JACKPOT' : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));`;
const idx = src.indexOf(old);
console.log('Pattern found at idx:', idx);
console.log('Occurrences:', (src.split(old).length - 1));

// Write without any changes
fs.writeFileSync(path, src, 'utf8');
const after = fs.statSync(path).size;
console.log('File size after write (no changes):', after);
