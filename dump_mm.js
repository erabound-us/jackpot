const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');
const idx = src.indexOf('function mmCheckNumbers');
console.log('MM func idx:', idx);
console.log('MM raw 800:', JSON.stringify(src.slice(idx, idx + 800)));
