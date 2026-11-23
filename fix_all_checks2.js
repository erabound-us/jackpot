const fs = require('fs');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

function sliceReplace(src, oldStr, newStr, label) {
  const idx = src.indexOf(oldStr);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'fixed at idx', idx);
  return src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
}

// --- LX ---
src = sliceReplace(src,
  `var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 53) {
        document.getElementById('lxCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 6 numbers for Line ' + (r+1) + ' (1-53).</div>';
        return;
      }
      line.push(lv);
    }
    allLines.push(line);
  }`,
  `var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var vals = Array.prototype.map.call(rowInputs, function(inp) { return inp.value.trim(); });
    if (vals.every(function(v) { return v === ''; })) continue;
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(vals[j]);
      if (isNaN(lv) || lv < 1 || lv > 53) {
        document.getElementById('lxCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 6 numbers for Line ' + (r+1) + ' (1-53).</div>';
        return;
      }
      line.push(lv);
    }
    allLines.push(line);
  }
  if (allLines.length === 0) {
    document.getElementById('lxCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter at least one complete line.</div>';
    return;
  }`,
  'LX'
);

// --- F5 ---
src = sliceReplace(src,
  `var f5AllLines = [];
  for (var r = 0; r < f5LineRows.length; r++) {
    var rowInputs = f5LineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 36) {
        document.getElementById('f5CheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 5 numbers for Line ' + (r+1) + ' (1-36).</div>'; return;
      }
      line.push(lv);
    }
    f5AllLines.push(line);
  }`,
  `var f5AllLines = [];
  for (var r = 0; r < f5LineRows.length; r++) {
    var rowInputs = f5LineRows[r].querySelectorAll('.num-input');
    var vals = Array.prototype.map.call(rowInputs, function(inp) { return inp.value.trim(); });
    if (vals.every(function(v) { return v === ''; })) continue;
    var line = [];
    for (var j = 0; j < rowInputs.length; j++) {
      var lv = parseInt(vals[j]);
      if (isNaN(lv) || lv < 1 || lv > 36) {
        document.getElementById('f5CheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Please enter all 5 numbers for Line ' + (r+1) + ' (1-36).</div>'; return;
      }
      line.push(lv);
    }
    f5AllLines.push(line);
  }
  if (f5AllLines.length === 0) {
    document.getElementById('f5CheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter at least one complete line.</div>';
    return;
  }`,
  'F5'
);

// --- PB ---
src = sliceReplace(src,
  `var allResults = []; var totalWin = 0; var pending = lineRows.length;
  var resultEl = document.getElementById('pbCheckResult');
  resultEl.innerHTML = '';
  var pp = parseInt(document.getElementById('pbPowerPlayCheck').value) || 0;
  for (var r = 0; r < lineRows.length; r++) {
    var inputs = lineRows[r].querySelectorAll('.num-input');
    var line = [];
    for (var j = 0; j < 5; j++) {
      var v = parseInt(inputs[j].value.trim());
      if (isNaN(v) || v < 1 || v > 69) { resultEl.innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter all 5 white numbers (1-69) for Line ' + (r+1) + '.</div>'; return; }
      line.push(v);
    }
    var pbPlayed = parseInt(inputs[5].value.trim());
    if (isNaN(pbPlayed) || pbPlayed < 1 || pbPlayed > 26) { resultEl.innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter Powerball (1-26) for Line ' + (r+1) + '.</div>'; return; }`,
  `var resultEl = document.getElementById('pbCheckResult');
  resultEl.innerHTML = '';
  var pp = parseInt(document.getElementById('pbPowerPlayCheck').value) || 0;
  var pbLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var inputs = lineRows[r].querySelectorAll('.num-input');
    var allVals = Array.prototype.map.call(inputs, function(inp) { return inp.value.trim(); });
    if (allVals.every(function(v) { return v === ''; })) continue;
    var line = [];
    for (var j = 0; j < 5; j++) {
      var v = parseInt(allVals[j]);
      if (isNaN(v) || v < 1 || v > 69) { resultEl.innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter all 5 white numbers (1-69) for Line ' + (r+1) + '.</div>'; return; }
      line.push(v);
    }
    var pbPlayed = parseInt(allVals[5]);
    if (isNaN(pbPlayed) || pbPlayed < 1 || pbPlayed > 26) { resultEl.innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter Powerball (1-26) for Line ' + (r+1) + '.</div>'; return; }
    pbLines.push({ line: line, pb: pbPlayed });
  }
  if (pbLines.length === 0) { resultEl.innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter at least one complete line.</div>'; return; }
  var allResults = []; var totalWin = 0; var pending = pbLines.length;
  for (var r = 0; r < pbLines.length; r++) {
    var line = pbLines[r].line;
    var pbPlayed = pbLines[r].pb;`,
  'PB'
);

// --- MM ---
src = sliceReplace(src,
  `var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var line = [], mbVal = null;
    for (var j = 0; j < rowInputs.length - 1; j++) {
      var lv = parseInt(rowInputs[j].value.trim());
      if (isNaN(lv) || lv < 1 || lv > 70) {
        document.getElementById('mmCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter all 5 white ball numbers (1-70) for Line ' + (r+1) + '.</div>'; return;
      }
      line.push(lv);
    }`,
  `var allLines = [];
  for (var r = 0; r < lineRows.length; r++) {
    var rowInputs = lineRows[r].querySelectorAll('.num-input');
    var allVals = Array.prototype.map.call(rowInputs, function(inp) { return inp.value.trim(); });
    if (allVals.every(function(v) { return v === ''; })) continue;
    var line = [], mbVal = null;
    for (var j = 0; j < rowInputs.length - 1; j++) {
      var lv = parseInt(allVals[j]);
      if (isNaN(lv) || lv < 1 || lv > 70) {
        document.getElementById('mmCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter all 5 white ball numbers (1-70) for Line ' + (r+1) + '.</div>'; return;
      }
      line.push(lv);
    }`,
  'MM'
);

// MM: also fix mbVal read and add empty-check after loop
src = sliceReplace(src,
  `    mbVal = parseInt(rowInputs[rowInputs.length-1].value.trim());
    if (isNaN(mbVal) || mbVal < 1 || mbVal > 25) {
      document.getElementById('mmCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter Mega Ball (1-25) for Line ' + (r+1) + '.</div>'; return;
    }
    allLines.push({ line: line, mb: mbVal });
  }
  var mp = parseInt(document.getElementById('mmMegaplierCheck').value) || 0;`,
  `    mbVal = parseInt(allVals[allVals.length-1]);
    if (isNaN(mbVal) || mbVal < 1 || mbVal > 25) {
      document.getElementById('mmCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter Mega Ball (1-25) for Line ' + (r+1) + '.</div>'; return;
    }
    allLines.push({ line: line, mb: mbVal });
  }
  if (allLines.length === 0) {
    document.getElementById('mmCheckResult').innerHTML = '<div style=\"color:var(--red);font-size:13px;\">Enter at least one complete line.</div>';
    return;
  }
  var mp = parseInt(document.getElementById('mmMegaplierCheck').value) || 0;`,
  'MM-mbVal+empty-check'
);

fs.writeFileSync(path, src, 'utf8');
console.log('Done. Size:', fs.statSync(path).size);
