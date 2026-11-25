const fs = require('fs');
const files = ['powerball_draws.json','megamillions_draws.json','jtp_draws.json','lottox_draws.json','fantasy5_draws.json','cashpop_draws.json','pick2_draws.json','pick3_draws.json','pick4_draws.json','pick5_draws.json'];
files.forEach(f => {
  try {
    const d = JSON.parse(fs.readFileSync(f,'utf8'));
    const sample = d[0] ? d[0].date : 'empty';
    process.stdout.write(f + ': ' + d.length + ' draws, sample: ' + sample + '\n');
  } catch(e) { process.stdout.write(f + ': ERROR ' + e.message + '\n'); }
});
