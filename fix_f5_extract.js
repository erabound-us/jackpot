const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

// Replace the scrapeFlDraws loop with direct HTML extraction
const old = `    const existing = getFantasy5Draws();
    for (const date of dates.slice(0, 5)) {
      for (const drawType of ['MIDDAY', 'EVENING']) {
        const alreadyHave = existing.some(d =>
          (d.date === date || stripLeadingZeros(d.date) === stripLeadingZeros(date)) && d.drawType === drawType
        );
        try {
          const r = await scrapeFlDraws('fantasy5', date, drawType);
          result.scraped.push({ date, drawType, numbers: r ? r.numbers : null, alreadyInCache: alreadyHave, wouldAppend: !alreadyHave && r && r.numbers && r.numbers.length === 5 });
        } catch(e) {
          result.errors.push({ date, drawType, error: e.message });
        }
      }
    }`;

const neu = `    const existing = getFantasy5Draws();
    // Extract numbers directly from the already-loaded HTML (avoids re-launching Chrome)
    for (const date of dates.slice(0, 5)) {
      const [mo, day, yr] = date.split('/');
      const isoDate = yr + '-' + mo.padStart(2,'0') + '-' + day.padStart(2,'0');
      const articleId = isoDate + '-fantasy5';
      const articleIdx = html.indexOf(articleId);
      if (articleIdx === -1) { result.errors.push({ date, error: 'article not found in HTML' }); continue; }
      const chunk = html.slice(articleIdx, articleIdx + 4000);
      for (const drawType of ['MIDDAY', 'EVENING']) {
        const alreadyHave = existing.some(d =>
          (d.date === date || stripLeadingZeros(d.date) === stripLeadingZeros(date)) && d.drawType === drawType
        );
        const dtLabel = drawType === 'MIDDAY' ? 'Midday' : 'Evening';
        const otherLabel = drawType === 'MIDDAY' ? 'Evening' : 'Midday';
        const dtIdx = chunk.indexOf(dtLabel);
        if (dtIdx === -1) { result.scraped.push({ date, drawType, numbers: null, alreadyInCache: alreadyHave, wouldAppend: false, note: 'label not found' }); continue; }
        const otherIdx = chunk.indexOf(otherLabel, dtIdx + dtLabel.length);
        const block = chunk.slice(dtIdx, otherIdx !== -1 ? otherIdx : dtIdx + 600);
        const numRe = /class="game-numbers__number"><span>(\\d+)<\\/span>/g;
        const nums = []; let nm;
        while ((nm = numRe.exec(block)) !== null) nums.push(parseInt(nm[1]));
        result.scraped.push({ date, drawType, numbers: nums.length ? nums : null, alreadyInCache: alreadyHave, wouldAppend: !alreadyHave && nums.length === 5 });
      }
    }`;

const idx = src.indexOf(old);
if (idx !== -1) {
  src = src.slice(0, idx) + neu + src.slice(idx + old.length);
  console.log('Extraction updated at idx', idx);
} else {
  console.log('NOT FOUND');
}

fs.writeFileSync(path, src, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
