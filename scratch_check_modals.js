const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const regex = /id=['"](modal[a-zA-Z0-9_-]+)['"]/g;
let m;
const modals = [];
while ((m = regex.exec(html)) !== null) {
  modals.push(m[1]);
}
console.log('Modals in index.html:', modals);
