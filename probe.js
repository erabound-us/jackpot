const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
const games = {
  jtp:      'https://floridalottery.com/games/draw-games/jackpot-triple-play',
  lottox:   'https://floridalottery.com/games/draw-games/florida-lotto',
  fantasy5: 'https://floridalottery.com/games/draw-games/fantasy5',
  powerball: 'https://floridalottery.com/games/draw-games/powerball'
};
(async () => {
  for (const [game, url] of Object.entries(games)) {
    const html = await get(url);
    const cls = html.match(/draw-game-jackpot[^>]*>([^<]+)</);
    const est = html.match(/estimated jackpot[^<]{0,80}\$(\d[\d,\.]+\s*(?:[Mm]illion|[Bb]illion)?)/i);
    const cur = html.match(/current jackpot[^<]{0,80}\$(\d[\d,\.]+\s*(?:[Mm]illion|[Bb]illion)?)/i);
    console.log(game + ':');
    console.log('  draw-game-jackpot class: ' + (cls ? cls[1].trim() : 'NOT FOUND'));
    console.log('  estimated jackpot:       ' + (est ? '$' + est[1].trim() : 'NOT FOUND'));
    console.log('  current jackpot:         ' + (cur ? '$' + cur[1].trim() : 'NOT FOUND'));
    console.log('---');
  }
})();
