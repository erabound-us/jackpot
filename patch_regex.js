const fs = require('fs');
let src = fs.readFileSync('server.js', 'utf8');

function replaceAll(old, nw, label) {
  let count = 0;
  while (src.includes(old)) { src = src.replace(old, nw); count++; }
  if (count === 0) console.error('NOT FOUND: ' + label);
  else console.log('Replaced x' + count + ': ' + label);
}

// Fix broken regex in PB scraper (line 3363)
replaceAll(
  'const numRe = /class="game-numbers__number"><span>([0-9]+)</span>/g;',
  'const numRe = /class="game-numbers__number"><span>([0-9]+)<\\/span>/g;',
  'numRe broken'
);

// Fix broken bonus-text regex in PB scraper (line 3366)
replaceAll(
  'const pbM = mainChunk.match(/game-numbers__bonus-text">([0-9]+)</span>/);',
  'const pbM = mainChunk.match(/game-numbers__bonus-text">([0-9]+)<\\/span>/);',
  'pbM broken'
);

// Fix broken bonus-text regex in MM scraper (line 3758)
replaceAll(
  'const mbM = chunk.match(/game-numbers__bonus-text">([0-9]+)</span>/);',
  'const mbM = chunk.match(/game-numbers__bonus-text">([0-9]+)<\\/span>/);',
  'mbM broken'
);

// Fix Pick scraper numRe (uses string-escaped backslash in template -- check)
// The Pick scraper uses: /class="game-numbers__number"><span>([0-9]+)<\/span>/g
// which in the patch script was written as a JS string with \\/ -- let's verify
const pickNumRe = src.match(/const numRe = \/class="game-numbers__number"><span>\(\[0-9\]\+\)(.*?)\/g;/);
if (pickNumRe) console.log('Pick numRe found:', pickNumRe[0]);

// Fix Pick scraper fbM bonus-text
replaceAll(
  'const fbM = block.match(/game-numbers__bonus-text">([0-9]+)<\\/span>/);',
  'const fbM = block.match(/game-numbers__bonus-text">([0-9]+)<\\/span>/);',
  'fbM already correct (no-op)'
);

fs.writeFileSync('server.js', src);
console.log('Done.');
