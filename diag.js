const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');
console.log('Read size:', src.length);
console.log('f5CheckNumbers count:', (src.match(/function f5CheckNumbers/g)||[]).length);
// Write same content back
fs.writeFileSync('C:\\Jackpot\\public\\index.html', src);
const after = fs.statSync('C:\\Jackpot\\public\\index.html').size;
console.log('After write size:', after);
