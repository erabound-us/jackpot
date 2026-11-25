const fs = require('fs');
const path = 'C:\\Jackpot\\.amazonq\\rules\\project.md';
let src = fs.readFileSync(path, 'utf8');

function sr(src, old, neu, label) {
  const idx = src.indexOf(old);
  if (idx === -1) { console.log(label, 'NOT FOUND'); return src; }
  console.log(label, 'updated');
  return src.slice(0, idx) + neu + src.slice(idx + old.length);
}

// 1. Node heap comment in Stack section - F5 no longer uses PDF parse
src = sr(src,
  `- **Node heap**: \`--max-old-space-size=768\` set in Dockerfile CMD -- Fantasy 5 PDF parse requires ~535MB RSS peak; 768MB heap gives comfortable headroom within the 1024MB machine RAM`,
  `- **Node heap**: \`--max-old-space-size=768\` set in Dockerfile CMD -- Lotto X PDF parse (~239MB RSS) is the largest remaining PDF parse; 768MB heap gives comfortable headroom within the 1024MB machine RAM. Fantasy 5 now uses Puppeteer (~108MB RSS) instead of PDF parse.`,
  'Stack heap comment'
);

// 2. Serialized Refresh Queue - F5 no longer a large PDF concern
src = sr(src,
  `- Prevents OOM from concurrent large PDF operations (Fantasy 5 = 2.7MB, Lotto X = 1MB)`,
  `- Prevents OOM from concurrent large PDF operations (Lotto X = 1MB is now the largest; Fantasy 5 uses Puppeteer instead of PDF parse)`,
  'Refresh queue OOM comment'
);

// 3. JSON Draw Cache section header - F5 no longer PDF-based
src = sr(src,
  `## JSON Draw Cache (Lotto X and Fantasy 5)
Large PDFs (Lotto X ~1MB, Fantasy 5 ~2.7MB) are **never parsed on Fly.io**. Instead:`,
  `## JSON Draw Cache (Lotto X and Fantasy 5)
Lotto X (~1MB PDF) uses a JSON draw cache -- **never parsed on Fly.io**. Fantasy 5 switched to Puppeteer-based refresh (Nov 2026) -- no PDF parse at all on Fly.io. Instead:`,
  'JSON Draw Cache header'
);

// 4. appendFantasy5Deltas description - now Puppeteer not PDF
src = sr(src,
  `- \`appendFantasy5Deltas()\` -- same for Fantasy 5`,
  `- \`appendFantasy5Deltas()\` -- **Puppeteer-based** (Nov 2026): scrapes FL Lottery website directly, no PDF parse. One Chrome launch gets all recent dates in ~20s at ~108MB RSS. Updates \`f5DrawsCache\` + \`fantasy5_draws.json\` in-place.`,
  'appendFantasy5Deltas description'
);

// 5. OOM safety startup chain - update to reflect F5 is now Puppeteer
src = sr(src,
  `**CRITICAL — OOM safety for startup delta chain**: ONLY JTP and Cash Pop run \`appendXxxDeltas()\` at startup. Lotto X, Fantasy 5, Powerball, and Mega Millions do NOT run their delta functions at startup. Running 4+ large PDF parses back-to-back at startup OOMs the 256MB heap (confirmed crash on Fly.io, Nov 2026). These games have committed JSON caches and \`schedulePostDrawRefreshes()\` keeps them current after each draw.`,
  `**CRITICAL — OOM safety for startup delta chain**: ONLY JTP and Cash Pop run \`appendXxxDeltas()\` at startup. Lotto X, Powerball, and Mega Millions do NOT run their delta functions at startup (large PDF parses). Fantasy 5 uses Puppeteer (not PDF) but also does NOT run at startup -- Chrome at startup OOMs. These games have committed JSON caches and \`schedulePostDrawRefreshes()\` keeps them current after each draw.`,
  'OOM startup chain'
);

// 6. NEVER add list - update to reflect F5 is Puppeteer
src = sr(src,
  `**NEVER add \`appendLottoXDeltas()\`, \`appendFantasy5Deltas()\`, \`appendPbDeltas()\`, or \`appendMmDeltas()\` to this startup chain.**`,
  `**NEVER add \`appendLottoXDeltas()\`, \`appendFantasy5Deltas()\`, \`appendPbDeltas()\`, or \`appendMmDeltas()\` to this startup chain.** Note: \`appendFantasy5Deltas()\` uses Puppeteer not PDF, but Chrome at startup still OOMs -- same rule applies.`,
  'NEVER add list'
);

// 7. Node heap in deployment section
src = sr(src,
  `- Node heap: \`--max-old-space-size=768\` in Dockerfile CMD -- Fantasy 5 PDF parse peaks at 535MB RSS; 768MB heap gives headroom within 1024MB machine RAM`,
  `- Node heap: \`--max-old-space-size=768\` in Dockerfile CMD -- Lotto X PDF parse peaks at ~239MB RSS; Fantasy 5 now uses Puppeteer (~108MB RSS). 768MB heap gives comfortable headroom within 1024MB machine RAM.`,
  'Deployment heap comment'
);

// 8. Chrome/Puppeteer disabled comment - now partially re-enabled for F5
src = sr(src,
  `**Chrome/Puppeteer is DISABLED in all \`/draws/*\` routes** — \`scrapeFlDraws\` is NOT called from any draw lookup route`,
  `**Chrome/Puppeteer is DISABLED in all \`/draws/*\` routes** — \`scrapeFlDraws\` is NOT called from any draw lookup route. Exception: \`appendFantasy5Deltas()\` uses Puppeteer for scheduled background refresh (not user-facing routes).`,
  'Chrome disabled comment'
);

// 9. Why appendFantasy5Deltas takes 2.5 minutes - now obsolete, update
src = sr(src,
  `**Why**: \`appendFantasy5Deltas()\` takes ~2.5 minutes on Fly.io and blocks the entire Node.js event loop (`,
  `**Why (historical)**: \`appendFantasy5Deltas()\` previously used PDF parse which took ~2.5 minutes and blocked the event loop (`,
  'Why F5 takes 2.5 min'
);

fs.writeFileSync(path, src, 'utf8');
console.log('Done. File size:', fs.statSync(path).size);
