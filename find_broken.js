const fs = require('fs');
const src = fs.readFileSync('C:\\Jackpot\\server.js', 'utf8');

// Find all broken instances
let i = 0;
while ((i = src.indexOf("prizeDisplay = 'approx ", i)) !== -1) {
  console.log('idx:', i, JSON.stringify(src.slice(i, i + 80)));
  i++;
}
