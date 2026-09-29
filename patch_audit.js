const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

// 1. Fix `/api/db/status` -> `/api/roster`
server = server.replace("if (reqPath === '/api/db/status') {", "if (reqPath === '/api/roster') {");

// 2. Extract Attendance PATCH from /api/roster and move it
const patchBlockStart = "      if (req.method === 'PATCH') {\r\n         if (!requireAdmin()) return;\r\n         \r\n         const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;\r\n         const recordId = urlParams.get('id');";
const patchBlockEnd = "            return handleApiError(res, e);\r\n         }\r\n      }";

// Wait, the line endings might be \n or \r\n. It's safer to use regex to replace the entire block.
const attendancePatchRegex = /if \(req\.method === 'PATCH'\) \{[\s\S]*?if \(!requireAdmin\(\)\) return;[\s\S]*?const urlParams = new URL\([^)]+\)\.searchParams;[\s\S]*?const recordId = urlParams\.get\('id'\);[\s\S]*?return handleApiError\(res, e\);[\s\S]*?\}/;

// Extract it completely (removing it from /api/roster)
server = server.replace(attendancePatchRegex, "");

// Add the extracted Attendance PATCH route back, and also add the missing /api/roster/student PATCH
const newRoutes = `
    // --- ATTENDANCE RECORD (MANUAL CORRECTION) ---
    if (reqPath === '/api/attendance/record') {
      if (req.method === 'PATCH') {
         if (!requireAdmin()) return;
         
         const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;
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
            
            logAudit(user, 'attendance modified', recordId, { oldStatus: auditEntry.oldStatus, newStatus: auditEntry.newStatus }); 
            return sendJson(res, 200, { success: true, record: updatedRecord });
         } catch (e) {
            return handleApiError(res, e);
         }
      }
    }

    // --- STUDENT STATUS UPDATE ---
    if (reqPath === '/api/roster/student' && req.method === 'PATCH') {
      if (!requireAdmin()) return;
      const body = await parseBody(req);
      const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;
      const rollNo = body.rollNo || urlParams.get('rollNo');
      if (!rollNo) return sendJson(res, 400, { success: false, error: 'rollNo required' });

      const current = await db.getStudents();
      const student = current.find(s => s.rollNo.toUpperCase() === rollNo.toUpperCase());
      if (!student) return sendJson(res, 404, { success: false, error: 'Student not found' });

      student.status = body.status === 'inactive' ? 'inactive' : 'active';
      await db.saveStudents(current);
      return sendJson(res, 200, { success: true, student });
    }
`;

server = server.replace("// 1b. DELETE INDIVIDUAL STUDENT", newRoutes + "\n    // 1b. DELETE INDIVIDUAL STUDENT");


// 3. Fix GET /api/sessions to prevent excessive data exposure
server = server.replace(/if \(reqPath === '\/api\/sessions'\) \{[\s\S]*?if \(req\.method === 'GET'\) \{[\s\S]*?const sessions = await db\.getSessions\(\);[\s\S]*?return sendJson\(res, 200, \{ success: true, sessions \}\);[\s\S]*?\}[\s\S]*?\}/, `if (reqPath === '/api/sessions') {
      if (req.method === 'GET') {
        let sessions = await db.getSessions();
        if (!isAdmin) {
           sessions = sessions.filter(s => s.employee === user.username);
        }
        return sendJson(res, 200, { success: true, sessions });
      }
    }`);

// 4. Fix POST /api/attendance/scan IDOR and Validation
const scanStart = "const { qrPayload, sessionName, eventId } = body;";
const scanReplacement = `const { qrPayload, eventId } = body;
      const sessionName = body.session || body.sessionName;`;
server = server.replace(scanStart, scanReplacement);

const sessionVerifyStart = "// Active session verify";
const sessionVerifyRegex = /\/\/ Active session verify[\s\S]*?if \(!sessionName\) \{[\s\S]*?return sendJson\(res, 400, \{ success: false, reason: 'no active session', error: 'No active session specified.' \}\);[\s\S]*?\}/;

const secureSessionVerify = `// Active session verify (IDOR & Auth Check)
      if (!sessionName) {
         return sendJson(res, 400, { success: false, reason: 'no active session', error: 'No active session specified.' });
      }
      
      const allSessions = await db.getSessions();
      const sessionObj = allSessions.find(s => s.sessionId === sessionName);
      if (!sessionObj) {
         return sendJson(res, 404, { success: false, reason: 'invalid session', error: 'The specified session does not exist.' });
      }
      if (sessionObj.status !== 'active') {
         return sendJson(res, 403, { success: false, reason: 'session closed', error: 'This session is already closed.' });
      }
      if (!isAdmin && sessionObj.employee !== user.username) {
         return sendJson(res, 403, { success: false, reason: 'unauthorized session', error: 'You are not authorized to mark attendance for another employee\\'s session.' });
      }
      
      // Override body.section with the actual session's section to ensure accurate data integrity
      body.section = sessionObj.section;`;

server = server.replace(sessionVerifyRegex, secureSessionVerify);


fs.writeFileSync('server.js', server);
console.log('Patched server.js: Routing mixups fixed, Attendance PATCH extracted, Student Status PATCH added, Scanner IDOR patched, and Session exposure restricted.');
