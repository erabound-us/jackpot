const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

// The broken fragment is exactly: 'approx \n        html +=
// (literal backslash-n, then newline, then spaces, then html +=)
// We need to restore: 'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));\n        f5LastWin = f5TotalWinAcc;\n        html +=

const broken = "'approx \\n        html += '<div class=\\\"check-total\\\">";
const fixed  = "'approx $' + f5TotalWinAcc.toLocaleString() : '$0'));\n        f5LastWin = f5TotalWinAcc;\n        html += '<div class=\"check-total\">";

if (src.includes(broken)) {
  src = src.replace(broken, fixed);
  console.log('Fixed with escaped version');
} else {
  // Try the actual string with real backslash-n
  const broken2 = "'approx \\\n        html += '<div class=\\\"check-total\\\">";
  if (src.includes(broken2)) {
    src = src.replace(broken2, fixed);
    console.log('Fixed with real newline version');
  } else {
    // Show raw
    const idx = src.indexOf("'approx ");
    const instances = [];
    let i = 0;
    while ((i = src.indexOf("'approx ", i)) !== -1) {
      instances.push({ idx: i, ctx: JSON.stringify(src.slice(i, i+80)) });
      i++;
    }
    console.log('All approx instances:', JSON.stringify(instances));
  }
}

fs.writeFileSync(path, src);
console.log('Done.');
