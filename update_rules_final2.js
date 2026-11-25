const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

function sr(src, old, neu, label) {
  const idx = src.indexOf(old);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'updated');
  return src.slice(0, idx) + neu + src.slice(idx + old.length);
}

src = sr(src,
  `- Node RSS at idle: ~117MB; peak with Fantasy 5 parse ~535MB; peak with Chrome ~267MB. Both fit within 1024MB.\n- Node heap: \`--max-old-space-size=768\` in Dockerfile CMD -- Fantasy 5 PDF parse peaks at 535MB RSS; 768MB heap gives comfortable headroom within 1024MB machine RAM`,
  `- Node RSS at idle: ~117MB; peak with Lotto X PDF parse ~239MB; peak with Chrome (Puppeteer) ~267MB; peak with Fantasy 5 Puppeteer scrape ~108MB. All fit within 1024MB.\n- Node heap: \`--max-old-space-size=768\` in Dockerfile CMD -- Lotto X PDF parse peaks at ~239MB RSS; Fantasy 5 now uses Puppeteer (~108MB). 768MB heap gives comfortable headroom within 1024MB machine RAM.`,
  'Deployment RSS + heap'
);

fs.writeFileSync(path, src, 'utf8');
console.log('Done.');
