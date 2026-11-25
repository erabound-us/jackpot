const fs = require('fs');
const { execSync } = require('child_process');
const path = 'C:\\Jackpot\\server.js';
let src = fs.readFileSync(path, 'utf8');

const oldEndpoint = `// Test endpoint: runs Puppeteer scrape for Fantasy 5 without modifying any cache
// GET /test/f5scrape -- returns available dates + scraped numbers for each, read-only
app.get('/test/f5scrape', async (req, res) => {`;

const newEndpoint = `// Test endpoint: runs Puppeteer scrape for Fantasy 5 without modifying any cache
// GET /test/f5scrape -- returns available dates + scraped numbers for each, read-only
// GET /test/f5scrape?dump=1 -- also returns first 5000 chars of raw HTML for diagnosis
app.get('/test/f5scrape', async (req, res) => {`;

// Also update the htmlSnippet to dump more and search for key patterns
const oldSnippet = `    result.htmlSnippet = html.slice(html.indexOf('fantasy5') > 0 ? html.indexOf('fantasy5') - 100 : 0, html.indexOf('fantasy5') + 200);`;
const newSnippet = `    // Diagnostic: search for key patterns that indicate draw results rendered
    result.hasGameNumbers = html.includes('game-numbers__number');
    result.hasDrawResults = html.includes('draw-results-item');
    result.hasArticleId = /\\d{4}-\\d{2}-\\d{2}-fantasy5/.test(html);
    result.htmlLength = html.length;
    if (req.query.dump) {
      // Find the most relevant section
      const gameIdx = html.indexOf('game-numbers');
      const articleIdx = html.indexOf('fantasy5-');
      const drawIdx = html.indexOf('draw-result');
      result.gameNumbersSection = gameIdx !== -1 ? html.slice(Math.max(0, gameIdx-50), gameIdx+300) : 'NOT FOUND';
      result.articleSection = articleIdx !== -1 ? html.slice(Math.max(0, articleIdx-50), articleIdx+300) : 'NOT FOUND';
      result.drawSection = drawIdx !== -1 ? html.slice(Math.max(0, drawIdx-50), drawIdx+300) : 'NOT FOUND';
      result.htmlHead = html.slice(0, 500);
      result.htmlTail = html.slice(-500);
    }`;

let updated = src;
const idx1 = updated.indexOf(oldEndpoint);
if (idx1 !== -1) {
  updated = updated.slice(0, idx1) + newEndpoint + updated.slice(idx1 + oldEndpoint.length);
  console.log('Endpoint comment updated');
} else { console.log('Endpoint comment NOT FOUND'); }

const idx2 = updated.indexOf(oldSnippet);
if (idx2 !== -1) {
  updated = updated.slice(0, idx2) + newSnippet + updated.slice(idx2 + oldSnippet.length);
  console.log('Snippet updated');
} else { console.log('Snippet NOT FOUND'); }

fs.writeFileSync(path, updated, 'utf8');
try {
  execSync('node --check server.js', { cwd: 'C:\\Jackpot', stdio: 'pipe' });
  console.log('Syntax OK');
} catch(e) { console.log('Syntax error:', e.stdout.toString()); }
