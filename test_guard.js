// Simulate the guard logic as deployed
const date = '11/20/2026';
const session = 'Morning';

const _nowET_cp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
const _todayET_cp = String(_nowET_cp.getMonth()+1).padStart(2,'0')+'/'+String(_nowET_cp.getDate()).padStart(2,'0')+'/'+_nowET_cp.getFullYear();
const _reqParts_cp = date.split('/');
const _reqYr_cp = parseInt(_reqParts_cp[2]);
const _reqMo_cp = parseInt(_reqParts_cp[0]);
const _reqDy_cp = parseInt(_reqParts_cp[1]);
const _todayParts_cp = _todayET_cp.split('/');
const _isToday_cp = _reqMo_cp === parseInt(_todayParts_cp[0]) && _reqDy_cp === parseInt(_todayParts_cp[1]) && _reqYr_cp === parseInt(_todayParts_cp[2]);
const _isFuture_cp = _reqYr_cp > parseInt(_todayParts_cp[2]) || (_reqYr_cp === parseInt(_todayParts_cp[2]) && (_reqMo_cp > parseInt(_todayParts_cp[0]) || (_reqMo_cp === parseInt(_todayParts_cp[0]) && _reqDy_cp > parseInt(_todayParts_cp[1]))));

process.stdout.write('nowET: ' + _nowET_cp + '\n');
process.stdout.write('todayET: ' + _todayET_cp + '\n');
process.stdout.write('isToday: ' + _isToday_cp + '\n');
process.stdout.write('isFuture: ' + _isFuture_cp + '\n');

const _sessionCutoffs = { morning: 7*60+29, matinee: 11*60+29, afternoon: 14*60+29, evening: 18*60+29, 'late night': 22*60+29 };
const _cutoff_cp = _sessionCutoffs[session.toLowerCase()];
const _nowMins_cp = _nowET_cp.getHours() * 60 + _nowET_cp.getMinutes();
process.stdout.write('nowMins: ' + _nowMins_cp + ' cutoff: ' + _cutoff_cp + '\n');
process.stdout.write('would block: ' + (_isToday_cp && session && _cutoff_cp && _nowMins_cp < _cutoff_cp) + '\n');
process.stdout.write('would pass to scraper: ' + (!_isFuture_cp && !(_isToday_cp && session && _cutoff_cp && _nowMins_cp < _cutoff_cp)) + '\n');
