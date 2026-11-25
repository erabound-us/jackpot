const fs = require('fs');

function fix4yr(date) {
  const p = date.split('/');
  if (p.length !== 3) return date;
  if (p[2].length === 2) p[2] = (parseInt(p[2]) > 50 ? '19' : '20') + p[2];
  return p.join('/');
}

const files = [
  'powerball_draws.json',
  'megamillions_draws.json',
  'jtp_draws.json',
  'lottox_draws.json',
  'fantasy5_draws.json',
];

files.forEach(f => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  let changed = 0;
  d.forEach(entry => {
    const fixed = fix4yr(entry.date);
    if (fixed !== entry.date) { entry.date = fixed; changed++; }
  });
  fs.writeFileSync(f, JSON.stringify(d, null, 2));
  process.stdout.write(f + ': fixed ' + changed + ' dates\n');
});
