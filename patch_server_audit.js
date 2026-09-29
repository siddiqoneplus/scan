const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

// 1. Add logAudit helper at the top (after parseBody)
if (!server.includes('async function logAudit')) {
   server = server.replace('async function parseBody(req) {', 
"async function logAudit(user, action, resource, metadata = {}) {\n" +
"  try {\n" +
"     const actor = user ? user.username : 'system';\n" +
"     const role = user ? user.role : 'system';\n" +
"     await db.addAuditLog({ actor, role, action, resource, metadata });\n" +
"  } catch(e) {}\n" +
"}\n\n" +
"async function parseBody(req) {");
}

// 2. Add /api/audit endpoint
const auditAPI = 
"    // --- AUDIT LOGS API ---\n" +
"    if (reqPath === '/api/audit') {\n" +
"      if (req.method === 'GET') {\n" +
"        if (!requireAdmin()) return;\n" +
"        try {\n" +
"          const urlParams = new URL('http://localhost' + req.url).searchParams;\n" +
"          const page = parseInt(urlParams.get('page')) || 1;\n" +
"          const limit = parseInt(urlParams.get('limit')) || 50;\n" +
"          const actionFilter = urlParams.get('action');\n" +
"          const actorFilter = urlParams.get('actor');\n" +
"          \n" +
"          let logs = await db.getAuditLogs();\n" +
"          \n" +
"          if (actionFilter) logs = logs.filter(l => l.action === actionFilter);\n" +
"          if (actorFilter) logs = logs.filter(l => l.actor === actorFilter);\n" +
"          \n" +
"          const total = logs.length;\n" +
"          const totalPages = Math.ceil(total / limit);\n" +
"          const startIdx = (page - 1) * limit;\n" +
"          const paginated = logs.slice(startIdx, startIdx + limit);\n" +
"          \n" +
"          return sendJson(res, 200, { success: true, data: paginated, pagination: { total, page, limit, totalPages } });\n" +
"        } catch(e) {\n" +
"          return sendJson(res, 500, { success: false, error: e.message });\n" +
"        }\n" +
"      }\n" +
"    }\n";

if (!server.includes('/api/audit')) {
  server = server.replace("if (reqPath === '/api/admin/dashboard')", auditAPI + "\n    if (reqPath === '/api/admin/dashboard')");
}

// 3. Inject into endpoints
server = server.replace(
  "return sendJson(res, 200, { success: true, token, user: userObj });",
  "logAudit(userObj, 'login', userObj.username, { ip: req.socket.remoteAddress }); return sendJson(res, 200, { success: true, token, user: userObj });"
);

server = server.replace(
  "return sendJson(res, 201, { success: true, message: 'Account created' });",
  "logAudit(user, 'employee created', body.username, { role: body.role }); return sendJson(res, 201, { success: true, message: 'Account created' });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: 'Account updated' });",
  "logAudit(user, 'employee updated', body.username, { role: body.role }); return sendJson(res, 200, { success: true, message: 'Account updated' });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: 'Account deleted' });",
  "logAudit(user, 'employee deactivated', body.username); return sendJson(res, 200, { success: true, message: 'Account deleted' });"
);

server = server.replace(
  "return sendJson(res, 201, { success: true, message: 'Student added' });",
  "logAudit(user, 'student created', secureStudent.rollNo, { branch: secureStudent.branch }); return sendJson(res, 201, { success: true, message: 'Student added' });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: 'Student updated' });",
  "logAudit(user, 'student updated', secureStudent.rollNo, { field: 'details' }); return sendJson(res, 200, { success: true, message: 'Student updated' });"
);

// Specifically handle student deletion vs attendance deletion
server = server.replace(
  "if(reqPath==='/api/students') logAudit(user, 'student deactivated', recordId); return sendJson(res, 200, { success: true, message: result.message, count: result.count });",
  "return sendJson(res, 200, { success: true, message: result.message, count: result.count });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: result.message, count: result.count });",
  "if(reqPath==='/api/students') logAudit(user, 'student deactivated', recordId); return sendJson(res, 200, { success: true, message: result.message, count: result.count });"
);

server = server.replace(
  "return sendJson(res, 201, { success: true, message: 'Session started', session: newSession });",
  "logAudit(user, 'attendance session started', newSession.sessionId, { subject: newSession.subject }); return sendJson(res, 201, { success: true, message: 'Session started', session: newSession });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: 'Session stopped', session: updated });",
  "logAudit(user, 'attendance session stopped', updated.sessionId, { subject: updated.subject }); return sendJson(res, 200, { success: true, message: 'Session stopped', session: updated });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, record: updatedRecord });",
  "logAudit(user, 'attendance modified', recordId, { oldStatus: auditEntry.oldStatus, newStatus: auditEntry.newStatus }); return sendJson(res, 200, { success: true, record: updatedRecord });"
);

server = server.replace(
  "return sendJson(res, 200, { success: true, message: 'Rules saved successfully' });",
  "logAudit(user, 'important configuration changes', 'branch_rules'); return sendJson(res, 200, { success: true, message: 'Rules saved successfully' });"
);

fs.writeFileSync('server.js', server);
console.log('Patched server.js for audit hooks correctly');
