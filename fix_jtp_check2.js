const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

const oldStr = `var lines = [];
  var lineCount = document.querySelectorAll('#myLinesInputs .line-input-row').length;
  for (var r = 0; r < lineCount; r++) {
    var row = document.querySelectorAll('#lineRow' + r + ' .num-input');
    var line = [];
    for (var j = 0; j < row.length; j++) {
      var lv = parseInt(row[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 46) {
        document.getElementById('checkResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 6 numbers for Line ' + (r+1) + ' (1-46).</div>';
        return;
      }
      line.push(lv);
    }
    lines.push(line);
  }`;

const newStr = `var lines = [];
  var lineCount = document.querySelectorAll('#myLinesInputs .line-input-row').length;
  for (var r = 0; r < lineCount; r++) {
    var row = document.querySelectorAll('#lineRow' + r + ' .num-input');
    var vals = Array.prototype.map.call(row, function(inp) { return inp.value.trim(); });
    if (vals.every(function(v) { return v === ''; })) continue;
    var line = [];
    for (var j = 0; j < row.length; j++) {
      var lv = parseInt(vals[j]);
      if (isNaN(lv) || lv < 1 || lv > 46) {
        document.getElementById('checkResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 6 numbers for Line ' + (r+1) + ' (1-46).</div>';
        return;
      }
      line.push(lv);
    }
    lines.push(line);
  }
  if (lines.length === 0) {
    document.getElementById('checkResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter at least one complete line.</div>';
    return;
  }`;

const idx = src.indexOf(oldStr);
if (idx !== -1) {
  src = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  console.log('Fixed at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done. Size:', fs.statSync(path).size);
