const fs = require('fs');

// --- 1. Patch db.js ---
let dbjs = fs.readFileSync('db.js', 'utf8');

const updateRecordFunc = `
async function updateAttendanceRecord(recordId, updates) {
  let logs = readJsonFile('attendance.json', []);
  const index = logs.findIndex(r => r.id === recordId);
  if (index === -1) throw new Error('Record not found');
  
  logs[index] = { ...logs[index], ...updates };
  writeJsonFile('attendance.json', logs);
  
  if (isConnected && db) {
    try {
      await db.collection('attendance').updateOne({ id: recordId }, { $set: updates });
    } catch (e) {
      console.warn('[MongoDB Atlas] Update attendance error:', e.message);
    }
  }
  return logs[index];
}
`;

if (!dbjs.includes('updateAttendanceRecord')) {
   dbjs = dbjs.replace('async function deleteAttendanceRecord', updateRecordFunc + '\nasync function deleteAttendanceRecord');
   dbjs = dbjs.replace('deleteAttendanceRecord,', 'deleteAttendanceRecord,\n  updateAttendanceRecord,');
   fs.writeFileSync('db.js', dbjs);
}

// --- 2. Patch server.js ---
let serverjs = fs.readFileSync('server.js', 'utf8');

const patchEndpoint = `
      if (req.method === 'PATCH') {
         if (!requireAdmin()) return;
         
         const urlParams = new URL('http://localhost' + req.url).searchParams;
         const recordId = urlParams.get('id');
         if (!recordId) return sendJson(res, 400, { success: false, error: 'Record ID required' });
         
         const body = await parseBody(req);
         if (!body.status || !['Present', 'Absent', 'Invalid'].includes(body.status)) {
            return sendJson(res, 400, { success: false, error: 'Valid status required (Present, Absent, Invalid)' });
         }
         
         try {
            const logs = await db.getAttendance();
            const record = logs.find(r => r.id === recordId);
            if (!record) return sendJson(res, 404, { success: false, error: 'Record not found' });
            
            const auditEntry = {
               oldStatus: record.status || 'Present',
               newStatus: body.status,
               changedBy: user.displayName || user.username,
               timestamp: new Date().toISOString(),
               reason: body.reason || ''
            };
            
            const auditTrail = record.auditTrail || [];
            auditTrail.push(auditEntry);
            
            const updatedRecord = await db.updateAttendanceRecord(recordId, {
               status: body.status,
               auditTrail: auditTrail
            });
            
            return sendJson(res, 200, { success: true, record: updatedRecord });
         } catch (e) {
            return sendJson(res, 500, { success: false, error: e.message });
         }
      }
`;

if (!serverjs.includes("if (req.method === 'PATCH')")) {
   serverjs = serverjs.replace("if (req.method === 'DELETE')", patchEndpoint + "\n\n      if (req.method === 'DELETE')");
   fs.writeFileSync('server.js', serverjs);
}
console.log('Patched backend for attendance edit');
