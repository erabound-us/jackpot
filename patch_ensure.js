const fs = require('fs');
let src = fs.readFileSync('server.js', 'utf8');

function replaceAll(old, nw, label) {
  let count = 0;
  while (src.includes(old)) { src = src.replace(old, nw); count++; }
  if (count === 0) console.error('NOT FOUND: ' + label);
  else console.log('Replaced x' + count + ': ' + label);
}

// JTP ensureDailyRefresh -- uses downloadPDFs
const jtpOld = `async function ensureDailyRefresh() {
  const today = todayET();
  if (lastAutoRefreshDate === today) return;
  if (autoRefreshPromise) return autoRefreshPromise;
  autoRefreshPromise = downloadPDFs().then(() => {
    lastAutoRefreshDate = today;
    autoRefreshPromise = null;
    console.log('Auto-refreshed PDFs for ' + today);
    return appendJtpDeltas();
  }).catch(err => {
    autoRefreshPromise = null;
    console.warn('Auto-refresh failed: ' + err.message + ' (using cached PDFs)');
  });
  return autoRefreshPromise;
}`;
const jtpNew = `async function ensureDailyRefresh() {}`;

// LX ensureDailyRefresh
const lxOld = `async function ensureDailyRefreshLottoX() {
  const today = todayET();
  if (lastAutoRefreshLottoX === today) return;
  if (autoRefreshLottoXPromise) return;
  autoRefreshLottoXPromise = downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => {
    lastAutoRefreshLottoX = today;
    autoRefreshLottoXPromise = null;
    console.log('Auto-refreshed Lotto X PDF for ' + today);
  }).catch(err => {
    autoRefreshLottoXPromise = null;
    console.warn('Lotto X auto-refresh failed: ' + err.message);
  });
  // Fire-and-forget -- parse handled by schedulePostDrawRefreshes
}`;
const lxNew = `async function ensureDailyRefreshLottoX() {}`;

// F5 ensureDailyRefresh
const f5Old = `async function ensureDailyRefreshF5() {
  const today = todayET();
  if (lastAutoRefreshF5 === today) return;
  if (autoRefreshF5Promise) return;
  autoRefreshF5Promise = downloadFile(PDF_URL_F5, PDF_PATH_F5).then(() => {
    lastAutoRefreshF5 = today;
    autoRefreshF5Promise = null;
    console.log('Auto-refreshed Fantasy 5 PDF for ' + today);
  }).catch(err => {
    autoRefreshF5Promise = null;
    console.warn('Fantasy 5 auto-refresh failed: ' + err.message);
  });
  // Fire-and-forget -- parse handled by schedulePostDrawRefreshes
}`;
const f5New = `async function ensureDailyRefreshF5() {}`;

// PB ensureDailyRefresh
const pbOld = `async function ensureDailyRefreshPB() {
  const today = todayET();
  if (lastAutoRefreshPB === today) return;
  if (autoRefreshPBPromise) return;
  autoRefreshPBPromise = downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => {
    lastAutoRefreshPB = today;
    autoRefreshPBPromise = null;
    console.log('Auto-refreshed Powerball PDF for ' + today);
  }).catch(err => {
    autoRefreshPBPromise = null;
    console.warn('Powerball auto-refresh failed: ' + err.message);
  });
  // Fire-and-forget -- parse handled by schedulePostDrawRefreshes
}`;
const pbNew = `async function ensureDailyRefreshPB() {}`;

// MM ensureDailyRefresh
const mmOld = `async function ensureDailyRefreshMM() {
  const today = todayET();
  if (lastAutoRefreshMM === today) return;
  if (autoRefreshMMPromise) return;
  autoRefreshMMPromise = downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => {
    lastAutoRefreshMM = today;
    autoRefreshMMPromise = null;
    console.log('Auto-refreshed Mega Millions PDF for ' + today);
  }).catch(err => {
    autoRefreshMMPromise = null;
    console.warn('Mega Millions auto-refresh failed: ' + err.message);
  });
  // Fire-and-forget -- parse handled by schedulePostDrawRefreshes
}`;
const mmNew = `async function ensureDailyRefreshMM() {}`;

// Pick ensureDailyRefresh
const pickOld = `async function ensureDailyRefreshPick(game) {
  const today = todayET();
  if (lastAutoRefreshPick[game] === today) return;
  if (autoRefreshPickPromise[game]) return autoRefreshPickPromise[game];
  const url = PDF_URLS_PICK[game], path = PDF_PATHS_PICK[game];
  autoRefreshPickPromise[game] = downloadFile(url, path).then(() => {
    lastAutoRefreshPick[game] = today;
    autoRefreshPickPromise[game] = null;
    pickCache[game] = null;
    pickDrawsCache[game] = null;
    console.log('Auto-refreshed ' + game + ' PDF for ' + today);
    return appendPickDeltas(game);
  }).catch(err => {
    autoRefreshPickPromise[game] = null;
    console.warn(game + ' auto-refresh failed: ' + err.message + ' (using cached PDF)');
  });
  return autoRefreshPickPromise[game];
}`;
const pickNew = `async function ensureDailyRefreshPick(game) {}`;

replaceAll(jtpOld, jtpNew, 'JTP ensureDailyRefresh');
replaceAll(lxOld, lxNew, 'LX ensureDailyRefresh');
replaceAll(f5Old, f5New, 'F5 ensureDailyRefresh');
replaceAll(pbOld, pbNew, 'PB ensureDailyRefresh');
replaceAll(mmOld, mmNew, 'MM ensureDailyRefresh');
replaceAll(pickOld, pickNew, 'Pick ensureDailyRefresh');

fs.writeFileSync('server.js', src);
console.log('Done.');
