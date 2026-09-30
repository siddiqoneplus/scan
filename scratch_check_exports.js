const fs = require('fs');
const path = require('path');

// 1. Collect all JS files
const jsFiles = fs.readdirSync('js').map(f => path.join('js', f));
const htmlFiles = ['index.html', 'login.html'];

// 2. Extract all inline calls: App.xxx, QRStudio.xxx, ScannerEngine.xxx, SessionManager.xxx, AttendanceManager.xxx, RosterManager.xxx, AuthManager.xxx, EventManager.xxx
const callRegex = /\b(App|QRStudio|ScannerEngine|SessionManager|AttendanceManager|RosterManager|AuthManager|EventManager)\.([a-zA-Z0-9_$]+)\s*\(/g;
const calls = {};

[...htmlFiles, ...jsFiles].forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = callRegex.exec(content)) !== null) {
    const obj = m[1];
    const fn = m[2];
    if (!calls[obj]) calls[obj] = new Set();
    calls[obj].add(`${fn} (used in ${file})`);
  }
});

console.log('--- FOUND CALLS ---');
for (const [obj, methods] of Object.entries(calls)) {
  console.log(`\n${obj}:`);
  for (const m of methods) {
    console.log(`  - ${m}`);
  }
}
