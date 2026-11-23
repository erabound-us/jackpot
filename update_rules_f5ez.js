const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

const old = `### POST /check/fantasy5 body
\`\`\`json
{
  "drawn": [3,12,19,27,34],
  "line": [3,12,19,22,34]
}
\`\`\`
- \`drawn\`: 5 numbers from 1\u201436
- \`line\`: 5 numbers from 1\u201436`;

const neu = `### POST /check/fantasy5 body
\`\`\`json
{
  "drawn": [3,12,19,27,34],
  "line": [3,12,19,22,34],
  "ezMatch": 20
}
\`\`\`
- \`drawn\`: 5 numbers from 1–36
- \`line\`: 5 numbers from 1–36
- \`ezMatch\`: 0–500, or omit — instant-win amount from EZMatch add-on (only on line 0/first line)`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('API spec updated');
} else {
  // try without unicode escapes
  const idx2 = src.indexOf('### POST /check/fantasy5 body');
  console.log('Section found at:', idx2, idx2 !== -1 ? JSON.stringify(src.slice(idx2, idx2+300)) : 'NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
