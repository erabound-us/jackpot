const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');

const a = 'class="text-xs[^"]*"[^>]*>([^<]+)</div><span class="game-numbers__number[^"]*">([0-9]+)</span>/g';
const b = 'class="text-xs[^"]*"[^>]*>([^<]+)<\\/div><span class="game-numbers__number[^"]*">([0-9]+)<\\/span>/g';
let n = 0; while (s.includes(a)) { s = s.replace(a, b); n++; }
fs.writeFileSync('server.js', s);
process.stdout.write('fixed:' + n + '\n');
