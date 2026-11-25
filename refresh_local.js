// refresh_local.js
// Downloads all PDFs fresh then re-runs generate_draw_cache.js
// Run locally: node refresh_local.js
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const PDFS = [
  ['https://files.floridalottery.com/exptkt/cash-pop_winning-numbers-history.pdf',       'cash-pop_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/fantasy5_winning-numbers-history.pdf',       'fantasy5_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/lotto_winning-numbers-history.pdf',          'lotto_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/pick2_winning-numbers-history.pdf',          'pick2_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/pick3_winning-numbers-history.pdf',          'pick3_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/pick4_winning-numbers-history.pdf',          'pick4_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/pick5_winning-numbers-history.pdf',          'pick5_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/powerball_winning-numbers-history.pdf',      'powerball_winning-numbers-history.pdf'],
  ['https://files.floridalottery.com/exptkt/mega-millions_winning-numbers-history.pdf',  'mega-millions_winning-numbers-history.pdf'],
];

// JTP uses a different URL pattern - check server.js
const JTP_URL = 'https://files.floridalottery.com/exptkt/jackpot-triple-play_winning-numbers-history.pdf';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) { file.close(); return reject(new Error(url + ' -> HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(fs.statSync(dest).size); });
    }).on('error', e => { file.close(); reject(e); });
  });
}

async function main() {
  console.log('=== Downloading fresh PDFs ===');
  for (const [url, filename] of PDFS) {
    const dest = 'C:/Jackpot/' + filename;
    const oldSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    try {
      const newSize = await download(url, dest);
      const changed = newSize !== oldSize;
      console.log(filename + ': ' + newSize + ' bytes' + (changed ? ' (CHANGED from ' + oldSize + ')' : ' (same)'));
    } catch(e) {
      console.log(filename + ': FAILED - ' + e.message);
    }
  }

  // JTP PDF
  try {
    const dest = 'C:/Jackpot/jtp.pdf';
    const oldSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const newSize = await download(JTP_URL, dest);
    console.log('jtp.pdf: ' + newSize + ' bytes' + (newSize !== oldSize ? ' (CHANGED)' : ' (same)'));
  } catch(e) {
    console.log('jtp.pdf: FAILED - ' + e.message);
  }

  console.log('\n=== Running generate_draw_cache.js ===');
  try {
    execSync('node generate_draw_cache.js', { cwd: 'C:/Jackpot', stdio: 'inherit' });
  } catch(e) {
    console.error('generate_draw_cache.js failed:', e.message);
    process.exit(1);
  }

  console.log('\n=== Checking results ===');
  const caches = ['cashpop','jtp','fantasy5','lottox','pick2','pick3','pick4','pick5','powerball','megamillions'];
  caches.forEach(g => {
    try {
      const j = JSON.parse(fs.readFileSync('C:/Jackpot/' + g + '_draws.json'));
      console.log(g + ': latest=' + j[0].date + ' count=' + j.length);
    } catch(e) { console.log(g + ': ERROR'); }
  });
}

main().catch(console.error);
