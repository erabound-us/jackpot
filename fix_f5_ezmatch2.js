const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\public\\index.html';
let src = fs.readFileSync(path, 'utf8');

function sr(src, old, neu, label) {
  const idx = src.indexOf(old);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'fixed at idx', idx);
  return src.slice(0, idx) + neu + src.slice(idx + old.length);
}

// 1. Pass ezMatch in fetch body
src = sr(src,
  `body: JSON.stringify({ drawn: drawn, line: lineNums }), signal: _acF5C.signal })
      .then(function(res) { return res.json(); })`,
  `body: JSON.stringify({ drawn: drawn, line: lineNums, ezMatch: lineIdx === 0 ? (parseInt(document.getElementById('f5EZMatch').value) || 0) : 0 }), signal: _acF5C.signal })
      .then(function(res) { return res.json(); })`,
  'fetch body'
);

// 2. Display EZMatch row after per-line result
src = sr(src,
  `          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
        });
        var anyJackpot`,
  `          html += ' &mdash; <span style="color:' + prizeColor + ';font-weight:700;">' + d.prizeDisplay + '</span></div>';
          if (idx === 0 && d.ezMatch > 0) html += '<div class="check-line-result winner" style="border-color:var(--green);"><span style="font-weight:700;">EZMatch</span> &mdash; <span style="color:var(--green);font-weight:700;">$' + d.ezMatch.toLocaleString() + '</span></div>';
        });
        var anyJackpot`,
  'display EZMatch row'
);

// 3. Add missing f5ClearCheck function (was never defined)
src = sr(src,
  `function f5AppendMsg(role, text) {`,
  `function f5ClearCheck() {
  document.getElementById('f5EZMatch').value = '0';
  document.querySelectorAll('#f5LinesInputs .num-input').forEach(function(inp) { inp.value = ''; inp.className = 'num-input'; });
  document.getElementById('f5CheckLineCount').value = '1';
  f5RebuildCheckLines();
  document.getElementById('f5CheckResult').innerHTML = '';
  document.getElementById('f5DrawDate').value = '';
  document.getElementById('f5DrawnDisplay').style.display = 'none';
  f5Drawn = [];
  f5LastWin = null;
}

function f5AppendMsg(role, text) {`,
  'f5ClearCheck function'
);

fs.writeFileSync(path, src, 'utf8');

// verify no syntax issues by checking for obvious JS problems
const count = (src.match(/function f5ClearCheck/g) || []).length;
console.log('f5ClearCheck definitions:', count);
console.log('Done. Size:', fs.statSync(path).size);
