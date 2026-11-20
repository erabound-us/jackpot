const fs = require('fs');
let c = fs.readFileSync('c:/Jackpot/.amazonq/rules/project.md', 'utf8');

// Add the abort pattern to the Race Conditions section
const insertAfter = '- Never write to shared state in a `.then()` without first verifying the triggering inputs haven\'t changed';
const addition = `\n\n**Pattern: Cancel Previous In-Flight Lookup (Abort Controller)**\nWhen a user clicks a new date chip before the previous lookup resolves, the previous request must be cancelled — not just ignored. Store the AbortController in a `window._xLookupAC` variable and abort it at the start of each new lookup:\n\n\`\`\`js\nfunction xLookupDraw() {\n  // ...\n  if (window._xLookupAC) window._xLookupAC.abort(); // cancel previous\n  window._xLookupAC = new AbortController();\n  setTimeout(function(){ if(window._xLookupAC) window._xLookupAC.abort(); }, 60000);\n  fetch('/draws/game?date=...', { signal: window._xLookupAC.signal })\n    .then(...)\n    .catch(function(e) { if (e.name === 'AbortError') return; /* handle other errors */ });\n}\n\`\`\`\n\n- Aborting the fetch causes the server to close the connection immediately, preventing the scraper from launching for the abandoned request\n- The `.catch()` must check for `AbortError` and return silently — don't show an error to the user for cancelled requests\n- **All 5 games implement this**: `window._jtpLookupAC`, `window._lxLookupAC`, `window._cpLookupAC`, `window._f5LookupAC`, `window._pickLookupAC`\n- **When adding a new game**: follow this exact pattern — store the controller in `window._xLookupAC`, abort at the top of `xLookupDraw()`, check for AbortError in catch`;

const idx = c.indexOf(insertAfter);
if (idx !== -1) {
  const end = c.indexOf('\n\n###', idx);
  c = c.substring(0, idx + insertAfter.length) + addition + c.substring(idx + insertAfter.length);
  process.stdout.write('inserted\n');
} else { process.stdout.write('NOT FOUND\n'); }

// Update backup ref
c = c.replace('Latest stable: `backups/stable-2026-11-20k`', 'Latest stable: `backups/stable-2026-11-20l`');

fs.writeFileSync('c:/Jackpot/.amazonq/rules/project.md', c, 'utf8');
process.stdout.write('done\n');
