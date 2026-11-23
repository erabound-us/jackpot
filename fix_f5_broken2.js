const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

// The broken line has a newline embedded inside the string literal.
// Use a regex to match from 'var totalDisplay = anyJackpot' up to 'f5LastWin'
// and replace the whole broken statement.
const broken = /        var totalDisplay = anyJackpot \? f5AllResults\.find\(function\(d\)\{return d\.isJackpot;\}\)\.prizeDisplay : \(anyFree \? 'Free Quick Pick' : \(f5TotalWinAcc > 0 \? 'approx [\s\S]*?f5LastWin = f5TotalWinAcc;/;

const replacement = `        var totalDisplay = anyJackpot ? f5AllResults.find(function(d){return d.isJackpot;}).prizeDisplay : (anyFree ? 'Free Quick Pick' : (f5TotalWinAcc > 0 ? 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));
        f5LastWin = f5TotalWinAcc;`;

const match = src.match(broken);
if (match) {
  console.log('Found broken block:', JSON.stringify(match[0]));
  src = src.replace(broken, replacement);
  console.log('Fixed.');
} else {
  // Show what's around the area
  const idx = src.indexOf("var totalDisplay = anyJackpot ? f5AllResults");
  console.log('Not matched by regex. Raw at idx', idx, ':', JSON.stringify(src.slice(idx, idx + 400)));
}

fs.writeFileSync(path, src);
console.log('Done.');
