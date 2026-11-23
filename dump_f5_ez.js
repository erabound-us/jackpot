const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');

// fetch body
let idx = src.indexOf('body: JSON.stringify({ drawn: drawn, line: lineNums }');
console.log('fetch body idx:', idx, idx !== -1 ? JSON.stringify(src.slice(idx, idx+150)) : 'NOT FOUND');

// per-line result display (F5 specific)
idx = src.indexOf("html += '<div class=\"check-line-result' + (isWinner ? ' winner' : '') + '\">';\n\n          html += '<span style=\"font-weight:700;\">' + label + '</span>");
console.log('display idx:', idx, idx !== -1 ? JSON.stringify(src.slice(idx, idx+300)) : 'NOT FOUND');

// f5ClearCheck
idx = src.indexOf('function f5ClearCheck()');
console.log('clearCheck idx:', idx, idx !== -1 ? JSON.stringify(src.slice(idx, idx+150)) : 'NOT FOUND');
