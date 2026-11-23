const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');
const idx = src.indexOf("var totalDisplay = anyJackpot ? f5AllResults");
console.log('idx:', idx);
console.log('raw 500 chars:', JSON.stringify(src.slice(idx, idx + 500)));
