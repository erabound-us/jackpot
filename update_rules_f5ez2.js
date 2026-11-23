const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

const old = `### POST /check/fantasy5 body\n\`\`\`json\n{\n  "drawn": [3,12,19,27,34],\n  "line": [3,12,19,22,34]\n}\n\`\`\`\n- \`drawn\`: 5 numbers from 1\u201336\n- \`line\`: 5 numbers from 1\u201336`;
const neu = `### POST /check/fantasy5 body\n\`\`\`json\n{\n  "drawn": [3,12,19,27,34],\n  "line": [3,12,19,22,34],\n  "ezMatch": 20\n}\n\`\`\`\n- \`drawn\`: 5 numbers from 1\u201336\n- \`line\`: 5 numbers from 1\u201336\n- \`ezMatch\`: 0\u2013500, or omit \u2014 instant-win amount from EZMatch add-on (first line only)`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('Updated at idx', idx);
} else {
  console.log('NOT FOUND, trying raw search...');
  const i2 = src.indexOf('### POST /check/fantasy5 body');
  const raw = src.slice(i2, i2 + 200);
  console.log(JSON.stringify(raw));
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
