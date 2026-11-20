// generate_draw_cache.js -- run locally to build initial JSON draw caches
// Usage: node generate_draw_cache.js
// Generates: lottox_draws.json, fantasy5_draws.json, jtp_draws.json, cashpop_draws.json
// CRITICAL: parsers here MUST match the server parsers in server.js exactly.
// When server parsers change, update this file too.
const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');

function extractPDFText(filePath) {
  return new Promise((resolve, reject) => {
    const p = new PDFParser(null, 1);
    const _w = console.warn; console.warn = () => {};
    p.on('pdfParser_dataReady', () => { console.warn = _w; resolve(p.getRawTextContent()); p.destroy(); });
    p.on('pdfParser_dataError', e => { console.warn = _w; reject(new Error(e.parserError)); });
    p.loadPDF(filePath);
  });
}

// Must match parseHistoryPDF in server.js
function parseJtp(text) {
  const draws = [];
  const re = /(\d{2}\/\d{2}\/\d{2,4})\s+([\d\s\-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (nums && nums.length >= 6) {
      const numbers = nums.slice(0, 6).map(Number).filter(n => n >= 1 && n <= 46);
      if (numbers.length === 6) {
        const parts = date.split('/');
        let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
        const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
        draws.push({ date, numbers, ts });
      }
    }
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws;
}

// Must match parseCashPopHistoryPDF in server.js
function parseCashPop(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].split('/');
    const ts = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    const numbers = [1,2,3,4,5].map(i => parseInt(m[i + 1])).filter(n => n >= 1 && n <= 15);
    if (numbers.length === 5) draws.push({ date: m[1], numbers, ts });
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws;
}

function parseLottoX(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+LOTTO(?!\s+DP)\s+\d/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (nums && nums.length >= 6) {
      const numbers = nums.slice(0, 6).map(Number).filter(n => n >= 1 && n <= 53);
      if (numbers.length === 6) {
        const p = date.split('/');
        let yy = parseInt(p[2]); if (yy < 100) yy += 2000;
        const ts = new Date(yy, parseInt(p[0]) - 1, parseInt(p[1])).getTime();
        draws.push({ date, numbers, ts });
      }
    }
  }
  draws.sort((a, b) => b.ts - a.ts);
  return draws; // NO cap -- full history for initial generation
}

function parseFantasy5(text) {
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(MIDDAY|EVENING)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const drawType = m[2].toUpperCase();
    const numbers = [3,4,5,6,7].map(i => parseInt(m[i])).filter(n => n >= 1 && n <= 36);
    if (numbers.length === 5) {
      const p = date.split('/');
      let yy = parseInt(p[2]); if (yy < 100) yy += 2000;
      const ts = new Date(yy, parseInt(p[0]) - 1, parseInt(p[1])).getTime();
      draws.push({ date, drawType, numbers, ts });
    }
  }
  draws.sort((a, b) => b.ts - a.ts || (a.drawType === 'EVENING' ? -1 : 1));
  // Filter out sentinel/corrupt entries (future dates are invalid)
  return draws.filter(d => d.ts <= Date.now() && d.ts > new Date('2000-01-01').getTime());
}

async function main() {
  console.log('Generating JTP draw cache...');
  const jtpText = await extractPDFText(path.join(__dirname, 'jtp.pdf'));
  const jtpDraws = parseJtp(jtpText);
  fs.writeFileSync(path.join(__dirname, 'jtp_draws.json'), JSON.stringify(jtpDraws.slice(0, 500), null, 2));
  console.log(`  Wrote ${Math.min(jtpDraws.length, 500)} draws (of ${jtpDraws.length} total) -> jtp_draws.json (latest: ${jtpDraws[0].date})`);

  console.log('Generating Cash Pop draw cache...');
  const cpText = await extractPDFText(path.join(__dirname, 'cash-pop_winning-numbers-history.pdf'));
  const cpDraws = parseCashPop(cpText);
  fs.writeFileSync(path.join(__dirname, 'cashpop_draws.json'), JSON.stringify(cpDraws.slice(0, 500), null, 2));
  console.log(`  Wrote ${Math.min(cpDraws.length, 500)} draws (of ${cpDraws.length} total) -> cashpop_draws.json (latest: ${cpDraws[0].date})`);

  console.log('Generating Lotto X draw cache...');
  const lxText = await extractPDFText(path.join(__dirname, 'lotto_winning-numbers-history.pdf'));
  const lxDraws = parseLottoX(lxText);
  fs.writeFileSync(path.join(__dirname, 'lottox_draws.json'), JSON.stringify(lxDraws.slice(0, 500), null, 2));
  console.log(`  Wrote ${Math.min(lxDraws.length, 500)} draws (of ${lxDraws.length} total) -> lottox_draws.json (latest: ${lxDraws[0].date})`);

  console.log('Generating Fantasy 5 draw cache...');
  const f5Text = await extractPDFText(path.join(__dirname, 'fantasy5_winning-numbers-history.pdf'));
  const f5Draws = parseFantasy5(f5Text);
  fs.writeFileSync(path.join(__dirname, 'fantasy5_draws.json'), JSON.stringify(f5Draws.slice(0, 500), null, 2));
  console.log(`  Wrote ${Math.min(f5Draws.length, 500)} draws (of ${f5Draws.length} total) -> fantasy5_draws.json (latest: ${f5Draws[0].date} ${f5Draws[0].drawType})`);

  console.log('Done.');
}

main().catch(console.error);
