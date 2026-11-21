var fs = require('fs');
var txt = fs.readFileSync('public/index.html','utf8');
var s = txt.indexOf('<script>') + 8;
var e = txt.indexOf('</script>', s);
var sc = txt.slice(s, e);
console.log('Script length:', sc.length);
var lo = 0, hi = sc.length;
var iterations = 0;
while (hi - lo > 200 && iterations < 50) {
  iterations++;
  var mid = Math.floor((lo + hi) / 2);
  try { new Function(sc.slice(0, mid)); lo = mid; } catch(err) { hi = mid; }
}
console.log('Error near offset:', lo, 'of', sc.length);
console.log(JSON.stringify(sc.slice(Math.max(0,lo-150), lo+150)));
