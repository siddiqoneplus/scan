const fs = require('fs');
const lines = fs.readFileSync('js/app.js', 'utf8').split('\n');
const targets = ['fetchAndRenderHistory', 'fetchAndRenderRoster', 'refreshKPIs', 'updateLiveTicker', 'submitEditRecord', 'fetchAuditLogs', 'delayFetchAudit', 'changeAuditPage'];
lines.forEach((line, idx) => {
  targets.forEach(t => {
    if (line.includes(t)) {
      console.log(`Line ${idx + 1} [${t}]: ${line.trim()}`);
    }
  });
});
