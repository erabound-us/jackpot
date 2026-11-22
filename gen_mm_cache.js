const PDFParser = require('pdf2json');
const fs = require('fs');
const p = new PDFParser(null, 1);
const w = console.warn; console.warn = () => {};
p.on('pdfParser_dataReady', () => {
  console.warn = w;
  const text = p.getRawTextContent();
  const draws = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([\d\s]+?)\s+MB\s+(\d{1,2})(?:\s+X\d+)?[\s\r\n]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const date = m[1];
    const nums = m[2].match(/\d+/g);
    if (!nums || nums.length < 5) continue;
    const white = nums.slice(0, 5).map(Number).filter(n => n >= 1 && n <= 70);
    const mb = parseInt(m[3]);
    if (white.length !== 5 || mb < 1 || mb > 25) continue;
    const parts = date.split('/');
    let yy = parseInt(parts[2]); if (yy < 100) yy += 2000;
    const ts = new Date(yy, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    if (ts > Date.now() || ts < new Date('2013-01-01').getTime()) continue;
    draws.push({ date, numbers: white, megaball: mb, ts });
  }
  draws.sort((a, b) => b.ts - a.ts);
  const final = draws.slice(0, 500);
  fs.writeFileSync('megamillions_draws.json', JSON.stringify(final, null, 2));
  console.log('Written ' + final.length + ' draws. Newest: ' + final[0].date + ' Oldest: ' + final[final.length-1].date);
  p.destroy();
});
p.on('pdfParser_dataError', e => { console.warn = w; console.error(e); });
p.loadPDF('mega-millions_winning-numbers-history.pdf');
