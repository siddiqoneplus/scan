const fs = require('fs');
let app = fs.readFileSync('js/app.js', 'utf8');

app = app.replace('function openModal(modalId) {', 'function openModal(modalId) {\n    document.body.classList.add("modal-open");');
app = app.replace('function closeModal(modalId) {', 'function closeModal(modalId) {\n    document.body.classList.remove("modal-open");');

fs.writeFileSync('js/app.js', app);
console.log('Patched app.js');
