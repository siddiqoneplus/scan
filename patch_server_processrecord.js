const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const oldBlock = `
        const allowedRolls = await getAllowedRolls();
        const roster = await db.getStudents();
        const today = new Date().toISOString().split('T')[0];
        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const existingLogs = await db.getAttendance();

        // Helper to process a single record securely
        const processRecord = (reqRecord) => {
          if (!reqRecord.rollNo || !reqRecord.session) {
             throw new Error('Missing rollNo or session');
          }
          
          const sessionObj = (await db.getSessions()).find(s => s.sessionId === reqRecord.session);
          
          if (!sessionObj) {
            // For backward compatibility, allow non-session strings (like event IDs or raw period strings)
            // But if it looks like a session ID, we reject it if not found.
            if (reqRecord.session.startsWith('session-')) {
               throw new Error('Session not found');
            }
          } else {
             if (sessionObj.status !== 'active') {
                throw new Error('Attendance session has ended or is inactive');
             }
          }
`;

const newBlock = `
        const allowedRolls = await getAllowedRolls();
        const roster = await db.getStudents();
        const today = new Date().toISOString().split('T')[0];
        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const existingLogs = await db.getAttendance();
        const allSessions = await db.getSessions();

        // Helper to process a single record securely
        const processRecord = (reqRecord) => {
          if (!reqRecord.rollNo || !reqRecord.session) {
             throw new Error('Missing rollNo or session');
          }
          
          const sessionObj = allSessions.find(s => s.sessionId === reqRecord.session);
          
          if (!sessionObj) {
            // For backward compatibility, allow non-session strings (like event IDs or raw period strings)
            // But if it looks like a session ID, we reject it if not found.
            if (reqRecord.session.startsWith('session-')) {
               throw new Error('Session not found');
            }
          } else {
             if (sessionObj.status !== 'active') {
                throw new Error('Attendance session has ended or is inactive');
             }
          }
`;

content = content.replace(oldBlock, newBlock);
fs.writeFileSync('server.js', content);
