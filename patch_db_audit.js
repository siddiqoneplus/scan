const fs = require('fs');

let dbjs = fs.readFileSync('db.js', 'utf8');

const auditFunctions = `
async function addAuditLog(entry) {
  const audit = {
    id: 'adt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    ...entry
  };
  
  let logs = readJsonFile('audit.json', []);
  logs.unshift(audit);
  
  // keep last 5000 locally
  if (logs.length > 5000) logs = logs.slice(0, 5000);
  writeJsonFile('audit.json', logs);
  
  if (isConnected && db) {
    try {
      await db.collection('audit_logs').insertOne(audit);
    } catch (e) {
      console.warn('[MongoDB Atlas] Add audit log error:', e.message);
    }
  }
}

async function getAuditLogs() {
  if (isConnected && db) {
    try {
      return await db.collection('audit_logs').find().sort({ timestamp: -1 }).toArray();
    } catch (e) {
      console.warn('[MongoDB Atlas] Get audit logs error:', e.message);
    }
  }
  return readJsonFile('audit.json', []);
}
`;

if (!dbjs.includes('addAuditLog')) {
   dbjs = dbjs.replace('module.exports = {', auditFunctions + '\nmodule.exports = {');
   dbjs = dbjs.replace('module.exports = {', 'module.exports = {\n  addAuditLog,\n  getAuditLogs,');
   fs.writeFileSync('db.js', dbjs);
}
console.log('Patched db.js with audit functions');
