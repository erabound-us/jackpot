const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
(async () => {
  const html = await get('https://floridalottery.com/games/draw-games/jackpot-triple-play');
  // Find the JS bundle URL
  const jsMatch = html.match(/clientlib-site[^"]+\.js/);
  if (!jsMatch) { console.log('No JS bundle found'); return; }
  const jsUrl = 'https://floridalottery.com/etc.clientlibs/flalottery-web/clientlibs/' + jsMatch[0];
  console.log('Fetching:', jsUrl);
  const js = await get(jsUrl);
  // Look for subscription key or API key patterns
  const patterns = [
    /Ocp-Apim-Subscription-Key[^"']{0,5}["']([^"']{20,50})/gi,
    /subscription[_-]?key[^"']{0,5}["']([^"']{20,50})/gi,
    /apiKey[^"']{0,5}["']([^"']{20,50})/gi,
    /x-api-key[^"']{0,5}["']([^"']{20,50})/gi,
    /apim[^"']{0,20}key[^"']{0,5}["']([^"']{20,50})/gi,
    /jackpot[^"']{0,50}amount/gi,
    /nextJackpot/gi,
    /jackpotAmount/gi,
  ];
  patterns.forEach(p => {
    const m = js.match(p);
    if (m) console.log('\n[' + p.source.slice(0,30) + ']', m.slice(0,3));
  });
})();
