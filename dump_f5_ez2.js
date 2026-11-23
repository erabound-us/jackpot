const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');

// find the per-line display block in f5CheckNumbers
let idx = src.indexOf("html += '<div class=\"check-line-result");
while (idx !== -1) {
  const ctx = src.slice(idx, idx + 50);
  if (ctx.includes('isWinner')) {
    console.log('display candidate at', idx, JSON.stringify(src.slice(idx, idx + 400)));
    break;
  }
  idx = src.indexOf("html += '<div class=\"check-line-result", idx + 1);
}

// f5ClearCheck
idx = src.indexOf('f5ClearCheck');
while (idx !== -1) {
  const ctx = src.slice(idx, idx + 200);
  if (ctx.includes('function')) {
    console.log('clearCheck at', idx, JSON.stringify(ctx));
    break;
  }
  idx = src.indexOf('f5ClearCheck', idx + 1);
}
// also search for the function definition directly
idx = src.indexOf('function f5Clear');
console.log('function f5Clear idx:', idx, idx !== -1 ? JSON.stringify(src.slice(idx, idx+200)) : 'NOT FOUND');
