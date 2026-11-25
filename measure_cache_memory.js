// measure_cache_memory.js
// Runs generate_draw_cache.js stages one at a time and reports heap usage
const { execSync, spawn } = require('child_process');
const fs = require('fs');

function heapMB() {
  const h = process.memoryUsage();
  return {
    heapUsed: Math.round(h.heapUsed / 1024 / 1024),
    heapTotal: Math.round(h.heapTotal / 1024 / 1024),
    rss: Math.round(h.rss / 1024 / 1024)
  };
}

const PDFParser = require('pdf2json');

function extractPDFText(filePath) {
  return new Promise((resolve, reject) => {
    const p = new PDFParser(null, 1);
    const _w = console.warn; console.warn = () => {};
    p.on('pdfParser_dataReady', () => { console.warn = _w; resolve(p.getRawTextContent()); p.destroy(); });
    p.on('pdfParser_dataError', e => { console.warn = _w; reject(new Error(e.parserError)); });
    p.loadPDF(filePath);
  });
}

const files = [
  ['JTP',         'jtp.pdf'],
  ['Cash Pop',    'cash-pop_winning-numbers-history.pdf'],
  ['Lotto X',     'lotto_winning-numbers-history.pdf'],
  ['Fantasy 5',   'fantasy5_winning-numbers-history.pdf'],
  ['Pick 2',      'pick2_winning-numbers-history.pdf'],
  ['Pick 3',      'pick3_winning-numbers-history.pdf'],
  ['Pick 4',      'pick4_winning-numbers-history.pdf'],
  ['Pick 5',      'pick5_winning-numbers-history.pdf'],
  ['Powerball',   'powerball_winning-numbers-history.pdf'],
  ['Mega Millions','mega-millions_winning-numbers-history.pdf'],
];

async function main() {
  console.log('Baseline:', heapMB());
  let peak = 0;

  for (const [label, file] of files) {
    const before = process.memoryUsage().rss;
    const start = Date.now();
    try {
      const text = await extractPDFText('C:/Jackpot/' + file);
      const elapsed = Date.now() - start;
      const mem = heapMB();
      if (mem.rss > peak) peak = mem.rss;
      console.log(label + ': ' + elapsed + 'ms | rss=' + mem.rss + 'MB heapUsed=' + mem.heapUsed + 'MB | text=' + Math.round(text.length/1024) + 'KB');
    } catch(e) {
      console.log(label + ': FAILED - ' + e.message);
    }
    // force GC hint
    if (global.gc) global.gc();
  }

  console.log('\nPeak RSS across all parses:', peak, 'MB');
  console.log('Final:', heapMB());
}

main().catch(console.error);
