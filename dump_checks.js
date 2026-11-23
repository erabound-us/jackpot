const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\public\\index.html', 'utf8');

const markers = [
  ['LX', 'var allLines = [];\n  for (var r = 0; r < lineRows.length; r++) {'],
  ['F5', 'var f5AllLines = [];\n  for (var r = 0; r < f5LineRows.length; r++) {'],
  ['PB', 'var allResults = []; var totalWin = 0; var pending = lineRows.length;'],
  ['MM', 'var allLines = [];\n\n  for (var r = 0; r < lineRows.length; r++) {'],
];

markers.forEach(([label, marker]) => {
  const idx = src.indexOf(marker);
  if (idx === -1) { console.log(label, 'NOT FOUND with marker'); return; }
  console.log(label, 'idx:', idx);
  console.log(label, 'raw:', JSON.stringify(src.slice(idx, idx + 500)));
  console.log('---');
});
