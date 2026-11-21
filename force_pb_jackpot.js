const http = require('http');

function post(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: 8080, path: path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 0 }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 8080, path: path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  const game = process.argv[2] || 'powerball';
  console.log('Forcing jackpot refresh for:', game);
  const r = await post('/jackpot/refresh?game=' + game);
  console.log('Queued:', r.body);
  console.log('Waiting 25s for Puppeteer to complete...');
  await new Promise(r => setTimeout(r, 25000));
  const r2 = await get('/jackpot?game=' + game);
  console.log('Result:', r2.body);
})();
