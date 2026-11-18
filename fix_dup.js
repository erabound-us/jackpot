const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');

const marker = 'Daily auto-refresh';
const first = s.indexOf(marker);
const second = s.indexOf(marker, first + 1);

// Cut from just before the second occurrence to end of file
const cutStart = s.lastIndexOf('\n', second - 1) + 1;
const removed = s.slice(cutStart);
s = s.slice(0, cutStart);

// The removed section contains the duplicate + the real end of file
// We need to keep: schedulePostDrawRefreshes(), rotateLogs(), start()
// Find those in the removed section
const keepFrom = removed.indexOf('\nschedulePostDrawRefreshes();');
if (keepFrom === -1) {
  console.log('keepFrom not found, checking removed:', removed.slice(0, 200));
  process.exit(1);
}
s = s + removed.slice(keepFrom);

fs.writeFileSync('server.js', s);
console.log('done');
