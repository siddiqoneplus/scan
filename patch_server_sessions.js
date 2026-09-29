const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const sessionEndpoints = `
    // --- SESSIONS API ---
    if (reqPath === '/api/sessions') {
      if (req.method === 'GET') {
        const sessions = await db.getSessions();
        return sendJson(res, 200, { success: true, sessions });
      }
    }
    
    if (reqPath === '/api/sessions/start') {
      if (req.method === 'POST') {
        if (!user) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
        const body = await parseBody(req);
        
        if (!body.subject || !body.section || !body.period) {
           return sendJson(res, 400, { success: false, error: 'Missing required session fields' });
        }
        
        const session = {
           sessionId: 'session-' + Date.now(),
           date: new Date().toISOString().split('T')[0],
           period: body.period,
           subject: body.subject,
           employee: user.username,
           branch: body.branch || '',
           year: body.year || '',
           section: body.section,
           startTime: new Date().toISOString(),
           status: 'active'
        };
        
        await db.saveSession(session);
        return sendJson(res, 200, { success: true, session });
      }
    }
    
    if (reqPath === '/api/sessions/stop') {
      if (req.method === 'POST') {
        if (!user) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
        const body = await parseBody(req);
        
        if (!body.sessionId) {
           return sendJson(res, 400, { success: false, error: 'Missing sessionId' });
        }
        
        const sessions = await db.getSessions();
        const session = sessions.find(s => s.sessionId === body.sessionId);
        if (!session) {
           return sendJson(res, 404, { success: false, error: 'Session not found' });
        }
        
        if (!isAdmin && session.employee !== user.username) {
           return sendJson(res, 403, { success: false, error: 'Cannot stop another employee\\'s session' });
        }
        
        session.endTime = new Date().toISOString();
        session.status = 'completed';
        
        await db.saveSession(session);
        return sendJson(res, 200, { success: true, session });
      }
    }
`;

// Insert the endpoints before "3. ATTENDANCE LOGS API"
content = content.replace('    // 3. ATTENDANCE LOGS API', sessionEndpoints + '\n    // 3. ATTENDANCE LOGS API');

fs.writeFileSync('server.js', content);
