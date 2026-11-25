const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\server.js', 'utf8');

// Find _appendFantasy5DeltasImpl
let idx = src.indexOf('async function _appendFantasy5DeltasImpl');
console.log('_appendFantasy5DeltasImpl idx:', idx);
if (idx !== -1) console.log(JSON.stringify(src.slice(idx, idx + 200)));

// Find evening retry
idx = src.indexOf("enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5");
while (idx !== -1) {
  console.log('\nfantasy5 enqueue at', idx, ':', JSON.stringify(src.slice(idx, idx + 150)));
  idx = src.indexOf("enqueueRefresh('fantasy5', () => downloadFile(PDF_URL_F5", idx + 1);
}
