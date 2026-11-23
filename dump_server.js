const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\server.js', 'utf8');
const idx = src.indexOf("else if (raw > 0)        { prize = raw; prizeDisplay = 'approx ");
console.log('idx:', idx);
console.log('raw 300 chars:', JSON.stringify(src.slice(idx - 10, idx + 300)));
