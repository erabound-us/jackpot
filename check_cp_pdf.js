const PDFParser = require('pdf2json');
const fs = require('fs');

function extractPDFText(filePath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
    parser.on('pdfParser_dataError', reject);
    parser.loadPDF(filePath);
  });
}

async function main() {
  console.log('Extracting CP PDF text (first 1000 chars)...');
  const text = await extractPDFText('C:/Jackpot/cash-pop_winning-numbers-history.pdf');
  console.log(text.slice(0, 1000));

  // Find dates
  const dateRe = /\d{1,2}\/\d{1,2}\/\d{4}/g;
  const dates = [...new Set(text.match(dateRe) || [])].slice(0, 10);
  console.log('\nFirst 10 dates found:', dates);

  // Run parse
  const re = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/g;
  const draws = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].split('/');
    const ts = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    const numbers = [1,2,3,4,5].map(i => parseInt(m[i+1])).filter(n => n >= 1 && n <= 15);
    if (numbers.length === 5) draws.push({ date: m[1], numbers, ts });
  }
  draws.sort((a,b) => b.ts - a.ts);
  console.log('\nMost recent parsed draws:', draws.slice(0,6).map(d => d.date + ' -> ' + d.numbers));

  const json = JSON.parse(fs.readFileSync('C:/Jackpot/cashpop_draws.json'));
  console.log('\nJSON newestTs:', json[0].date, '(ts:', json[0].ts + ')');
  const newDraws = draws.filter(d => d.ts > json[0].ts);
  console.log('New draws that would be appended:', newDraws.length, newDraws.map(d => d.date));
}

main().catch(console.error);
