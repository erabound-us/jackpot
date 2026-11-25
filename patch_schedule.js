const fs = require('fs');
let src = fs.readFileSync('server.js', 'utf8');

// ── schedulePostDrawRefreshes patches ─────────────────────────────────────────

// 1. JTP: remove PDF download, call appendJtpDeltas directly
const jtpOld = `enqueueRefresh('jtp', () => downloadPDFs().then(() => { lastAutoRefreshDate = null; jtpDrawsCache = null; }).then(() => appendJtpDeltas()).catch(() => {}));`;
const jtpNew = `enqueueRefresh('jtp', () => appendJtpDeltas().catch(() => {}));`;

// 2. LX: remove PDF download, call appendLottoXDeltas directly (appears twice in schedule)
const lxOld = `enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => { lastAutoRefreshLottoX = null; return appendLottoXDeltas(); }));`;
const lxNew = `enqueueRefresh('lottox', () => appendLottoXDeltas().catch(() => {}));`;

// 3. PB: remove PDF download, call appendPbDeltas directly (appears twice)
const pbOld = `enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => { lastAutoRefreshPB = null; pbDrawsCache = null; }).then(() => appendPbDeltas()).catch(() => {}));`;
const pbNew = `enqueueRefresh('powerball', () => appendPbDeltas().catch(() => {}));`;

// 4. MM: remove PDF download, call appendMmDeltas directly (appears twice)
const mmOld = `enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => { lastAutoRefreshMM = null; mmDrawsCache = null; }).then(() => appendMmDeltas()).catch(() => {}));`;
const mmNew = `enqueueRefresh('megamillions', () => appendMmDeltas().catch(() => {}));`;

// 5. Pick: remove PDF download, call appendPickDeltas directly (appears twice)
const pickOld = `enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; pickDrawsCache[g] = null; }).then(() => appendPickDeltas(g)).catch(() => {}));`;
const pickNew = `enqueueRefresh(g, () => appendPickDeltas(g).catch(() => {}));`;

// 6. /refresh/lottox route: remove PDF download
const lxRefreshOld = `enqueueRefresh('lottox', () => downloadFile(PDF_URLS_LX, PDF_PATH_LX).then(() => {\n    lastAutoRefreshLottoX = null; return appendLottoXDeltas();\n  }));`;
const lxRefreshNew = `enqueueRefresh('lottox', () => appendLottoXDeltas().catch(() => {}));`;

// 7. /refresh/powerball route: remove PDF download
const pbRefreshOld = `enqueueRefresh('powerball', () => downloadFile(PDF_URL_PB, PDF_PATH_PB).then(() => {\n    lastAutoRefreshPB = null; pbDrawsCache = null; return appendPbDeltas();\n  }));`;
const pbRefreshNew = `enqueueRefresh('powerball', () => appendPbDeltas().catch(() => {}));`;

// 8. /refresh/megamillions route: remove PDF download
const mmRefreshOld = `enqueueRefresh('megamillions', () => downloadFile(PDF_URL_MM, PDF_PATH_MM).then(() => {\n    lastAutoRefreshMM = null; mmDrawsCache = null; return appendMmDeltas();\n\n  }));`;
const mmRefreshNew = `enqueueRefresh('megamillions', () => appendMmDeltas().catch(() => {}));`;

// 9. /refresh/pick route: remove PDF download
const pickRefreshOld = `Object.entries(PDF_URLS_PICK).forEach(([g, url]) => {\n    enqueueRefresh(g, () => downloadFile(url, PDF_PATHS_PICK[g]).then(() => { pickCache[g] = null; }));\n  });`;
const pickRefreshNew = `Object.entries(PDF_URLS_PICK).forEach(([g]) => {\n    enqueueRefresh(g, () => appendPickDeltas(g).catch(() => {}));\n  });`;

function replaceAll(old, nw, label) {
  let count = 0;
  while (src.includes(old)) { src = src.replace(old, nw); count++; }
  if (count === 0) console.error('NOT FOUND: ' + label);
  else console.log('Replaced x' + count + ': ' + label);
}

replaceAll(jtpOld, jtpNew, 'JTP schedule');
replaceAll(lxOld, lxNew, 'LX schedule');
replaceAll(pbOld, pbNew, 'PB schedule');
replaceAll(mmOld, mmNew, 'MM schedule');
replaceAll(pickOld, pickNew, 'Pick schedule');
replaceAll(lxRefreshOld, lxRefreshNew, 'LX /refresh route');
replaceAll(pbRefreshOld, pbRefreshNew, 'PB /refresh route');
replaceAll(mmRefreshOld, mmRefreshNew, 'MM /refresh route');
replaceAll(pickRefreshOld, pickRefreshNew, 'Pick /refresh route');

fs.writeFileSync('server.js', src);
console.log('Done.');
