const fs = require('fs');
let src = fs.readFileSync('public/index.html', 'utf8');

const goldBall = '<div class=\\"hball\\" style=\\"background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;\\">' + n + '</div>';

// Fix Lotto X latestdraw — change blue to gold
src = src.replace(
  "fetch('/latestdraw/lottox').then(function(r){return r.json();}).then(function(d){\n  if (d.error) return;\n  lxDrawn = d.numbers;\n  document.getElementById('lxDrawDate').value = mmddyyToInputDate(d.date);\n  document.getElementById('lxDrawnDisplay').style.display = 'block';\n  document.getElementById('lxDrawnBalls').innerHTML = d.numbers.map(function(n){\n    return '<div class=\"hball\" style=\"background:rgba(79,142,247,0.15);color:var(--accent);border-color:rgba(79,142,247,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n  }).join('');\n}).catch(function(){});",
  "fetch('/latestdraw/lottox').then(function(r){return r.json();}).then(function(d){\n  if (d.error) return;\n  lxDrawn = d.numbers;\n  document.getElementById('lxDrawDate').value = mmddyyToInputDate(d.date);\n  document.getElementById('lxDrawnDisplay').style.display = 'block';\n  document.getElementById('lxDrawnBalls').innerHTML = d.numbers.map(function(n){\n    return '<div class=\"hball\" style=\"background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n  }).join('');\n}).catch(function(){});"
);

// Fix Fantasy 5 latestdraw — change blue to gold
src = src.replace(
  "  document.getElementById('f5DrawnBalls').innerHTML = latest.numbers.map(function(n){\n    return '<div class=\"hball\" style=\"background:rgba(79,142,247,0.15);color:var(--accent);border-color:rgba(79,142,247,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n  }).join('');",
  "  document.getElementById('f5DrawnBalls').innerHTML = latest.numbers.map(function(n){\n    return '<div class=\"hball\" style=\"background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n  }).join('');"
);

// Also fix the lxLookupDraw and f5LookupDraw ball colors to gold (when user picks a date)
src = src.replace(
  "document.getElementById('lxDrawnBalls').innerHTML = data.numbers.map(function(n) {\n        return '<div class=\"hball\" style=\"background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n      }).join('');",
  "document.getElementById('lxDrawnBalls').innerHTML = data.numbers.map(function(n) {\n        return '<div class=\"hball\" style=\"background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n      }).join('');"
);

src = src.replace(
  "document.getElementById('f5DrawnBalls').innerHTML = data.numbers.map(function(n) {\n        return '<div class=\"hball\" style=\"background:rgba(79,142,247,0.15);color:var(--accent);border-color:rgba(79,142,247,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n      }).join('');",
  "document.getElementById('f5DrawnBalls').innerHTML = data.numbers.map(function(n) {\n        return '<div class=\"hball\" style=\"background:rgba(245,158,11,0.15);color:var(--yellow);border-color:rgba(245,158,11,0.4);width:36px;height:36px;font-size:13px;\">' + n + '</div>';\n      }).join('');"
);

fs.writeFileSync('public/index.html', src, 'utf8');
console.log('Done');
