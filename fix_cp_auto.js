const fs = require('fs');
let src = fs.readFileSync('public/index.html', 'utf8');

// When session hasn't drawn yet, auto-switch to the latest available session
src = src.replace(
  "      if (data.error) {\n        msg.style.color = 'var(--red)';\n        if (data.allSessions && data.allSessions.length) {\n          // Session not drawn yet — show what IS available\n          var avail = data.allSessions.map(function(s) { return s.name; }).join(', ');\n          msg.innerHTML = 'That session has not drawn yet. Available: <strong style=\"color:var(--text);\">' + avail + '</strong>';\n        } else {\n          msg.textContent = data.error;\n          if (data.resultsUrl) msg.innerHTML = data.error + ' <a href=\"' + data.resultsUrl + '\" target=\"_blank\" style=\"color:var(--accent);\">View official results</a>';\n        }\n        return;\n      }",
  "      if (data.error) {\n        if (data.allSessions && data.allSessions.length) {\n          // Session not drawn yet — auto-switch to latest available session\n          var latest = data.allSessions[data.allSessions.length - 1];\n          document.getElementById('cpDrawSession').value = latest.name;\n          cpLookupDraw();\n        } else {\n          msg.style.color = 'var(--red)';\n          msg.textContent = data.error;\n          if (data.resultsUrl) msg.innerHTML = data.error + ' <a href=\"' + data.resultsUrl + '\" target=\"_blank\" style=\"color:var(--accent);\">View official results</a>';\n        }\n        return;\n      }"
);

fs.writeFileSync('public/index.html', src, 'utf8');
console.log('Done');
