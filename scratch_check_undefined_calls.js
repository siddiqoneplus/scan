const fs = require('fs');

const appJs = fs.readFileSync('js/app.js', 'utf8');

// Find all function declarations in app.js
const fnDeclRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
const declaredFns = new Set();
let m;
while ((m = fnDeclRegex.exec(appJs)) !== null) {
  declaredFns.add(m[1]);
}

// Find const/let fn declarations
const constFnRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g;
while ((m = constFnRegex.exec(appJs)) !== null) {
  declaredFns.add(m[1]);
}

console.log('Total declared functions in app.js:', declaredFns.size);

// Find all function calls in app.js that look like direct calls: foo(...)
// Exclude JS built-ins and keywords
const builtins = new Set([
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'confirm', 'alert', 'prompt',
  'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
  'fetch', 'escapeHtml', 'formatDate', 'showToast', 'Boolean', 'Number', 'String', 'Array',
  'Object', 'Set', 'Map', 'RegExp', 'Date', 'Math', 'JSON', 'console', 'document', 'window',
  'localStorage', 'sessionStorage', 'require', 'if', 'for', 'while', 'switch', 'catch'
]);

const callRegex = /(?<!\.)\b([a-zA-Z0-9_$]+)\s*\(/g;
const missingFns = new Set();

while ((m = callRegex.exec(appJs)) !== null) {
  const name = m[1];
  if (!declaredFns.has(name) && !builtins.has(name) && !name.startsWith('on') && !name.startsWith('is') && !name.startsWith('get') && !name.startsWith('set')) {
    // Check if it's a global or imported
    missingFns.add(name);
  }
}

console.log('\nPotential undefined direct function calls in app.js:');
console.log(Array.from(missingFns));
