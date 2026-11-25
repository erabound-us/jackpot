const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
const a = 'class="game-numbers__number"><span>([0-9]+)</span>/g';
const b = 'class="game-numbers__number"><span>([0-9]+)<\\/span>/g';
let n = 0; while (s.includes(a)) { s = s.replace(a, b); n++; }
const c = 'game-numbers__bonus-text">([0-9]+)</span>/';
const d = 'game-numbers__bonus-text">([0-9]+)<\\/span>/';
let m = 0; while (s.includes(c)) { s = s.replace(c, d); m++; }
fs.writeFileSync('server.js', s);
process.stdout.write('numRe:' + n + ' bonus:' + m + '\n');
