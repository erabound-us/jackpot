const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

const oldStr = `' total matches across all 3 lines &mdash; `;
const newStr = `' total matches across all ' + lines.length + ' line' + (lines.length !== 1 ? 's' : '') + ' &mdash; `;

const idx = src.indexOf(oldStr);
if (idx !== -1) {
  src = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  console.log('Combo label fixed at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done. Size:', fs.statSync(path).size);
