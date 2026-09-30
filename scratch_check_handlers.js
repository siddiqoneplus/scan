const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const regex = /on(?:click|submit|change|input)\s*=\s*['"]([^'"]+)['"]/gi;
let match;
const handlers = new Set();
while ((match = regex.exec(html)) !== null) {
  handlers.add(match[1]);
}
console.log('Total inline handlers:', handlers.size);
console.log(JSON.stringify(Array.from(handlers).sort(), null, 2));
