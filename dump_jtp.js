const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');
const idx = src.indexOf("var lines = [];\n  var lineCount = document.querySelectorAll('#myLinesInputs .line-input-row').length;");
console.log('idx:', idx);
console.log('raw:', JSON.stringify(src.slice(idx, idx + 600)));
