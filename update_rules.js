const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

const insertAfter = `## Check My Numbers — Full Checklist (when adding a new game)`;
const newSection = `

## Check My Numbers — Optional Lines Rule

All Check My Numbers functions MUST skip fully-empty rows rather than requiring every row to be filled. A user with 1 line on a 3-line ticket should not be forced to fill all 3 rows.

**Pattern (apply to every game's check function):**
\`\`\`js
var vals = Array.prototype.map.call(rowInputs, function(inp) { return inp.value.trim(); });
if (vals.every(function(v) { return v === ''; })) continue;  // skip blank rows
// then validate each val in the row
\`\`\`
- After the loop, add: \`if (lines.length === 0) { show error "Enter at least one complete line."; return; }\`
- A partially-filled row (some inputs filled, some blank) still shows the per-field validation error
- **Server-side**: routes that previously required exactly N lines must accept 1–N lines. Example: \`/check\` (JTP) changed from \`lines.length !== 3\` to \`lines.length < 1 || lines.length > 3\`
- **Combo label**: use \`lines.length\` dynamically instead of hardcoded "3 lines"
- Applied to: JTP, LX, F5, PB, MM (Nov 2026)
- Pick and Cash Pop check single values, not multi-line — this rule does not apply to them
- **NEVER use \`String.replace()\` with replacement strings containing \`$\`** — use \`src.slice(0, idx) + newStr + src.slice(idx + old.length)\` instead. \`$'\` in a replacement string inserts the text after the match, causing massive file corruption.`;

const idx = src.indexOf(insertAfter);
if (idx !== -1) {
  src = src.slice(0, idx) + newSection.trimStart() + '\n\n' + insertAfter + src.slice(idx + insertAfter.length);
  console.log('Rule inserted before checklist at idx', idx);
} else {
  // append at end
  src += newSection;
  console.log('Rule appended at end');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
