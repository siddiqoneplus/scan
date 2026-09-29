const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const historyEndpoint = `
    // --- ATTENDANCE HISTORY (PAGINATED & FILTERED) ---
    if (reqPath === '/api/attendance/history') {
      if (req.method === 'GET') {
        const urlParams = new URL('http://localhost' + req.url).searchParams;
        const page = parseInt(urlParams.get('page')) || 1;
        const limit = parseInt(urlParams.get('limit')) || 50;
        const startDate = urlParams.get('startDate');
        const endDate = urlParams.get('endDate');
        const branch = urlParams.get('branch');
        const year = urlParams.get('year');
        const section = urlParams.get('section');
        const subject = urlParams.get('subject');
        const employee = urlParams.get('employee');

        try {
           let logs = await db.getAttendance();
           
           // Apply Employee-level Security Filtering
           if (!isAdmin) {
             const roster = await db.getStudents();
             const allowedRolls = new Set(
               roster.filter(s => (s.assignedTo || 'all') === 'all' || s.assignedTo === user.username)
                     .map(s => s.rollNo.toUpperCase())
             );
             logs = logs.filter(log => allowedRolls.has((log.rollNo || '').toUpperCase()));
           }
           
           // Enrich with Session Data (for Subject & Employee filters)
           const sessions = await db.getSessions();
           const sessionMap = new Map();
           sessions.forEach(s => sessionMap.set(s.sessionId, s));
           
           const enrichedLogs = logs.map(log => {
              const sessionObj = sessionMap.get(log.session);
              return {
                 ...log,
                 subject: sessionObj ? sessionObj.subject : (log.eventId || 'General'),
                 sessionEmployee: sessionObj ? sessionObj.employee : log.markedBy
              };
           });
           
           // Apply Filters
           let filtered = enrichedLogs;
           
           if (startDate) {
              filtered = filtered.filter(l => l.date >= startDate);
           }
           if (endDate) {
              filtered = filtered.filter(l => l.date <= endDate);
           }
           if (branch) {
              filtered = filtered.filter(l => l.branch === branch);
           }
           if (year) {
              filtered = filtered.filter(l => l.year === year);
           }
           if (section) {
              filtered = filtered.filter(l => l.section && l.section.toUpperCase() === section.toUpperCase());
           }
           if (subject) {
              filtered = filtered.filter(l => l.subject && l.subject.toLowerCase().includes(subject.toLowerCase()));
           }
           if (employee) {
              filtered = filtered.filter(l => l.sessionEmployee === employee || l.markedBy === employee);
           }
           
           // Sort by newest first (date desc, then timestamp desc)
           filtered.sort((a, b) => {
              if (a.date !== b.date) return a.date > b.date ? -1 : 1;
              return a.timestamp > b.timestamp ? -1 : 1;
           });
           
           const total = filtered.length;
           const totalPages = Math.ceil(total / limit);
           const startIdx = (page - 1) * limit;
           const paginated = filtered.slice(startIdx, startIdx + limit);
           
           return sendJson(res, 200, {
             success: true,
             data: paginated,
             pagination: {
                total,
                page,
                limit,
                totalPages
             }
           });
        } catch (err) {
           return sendJson(res, 500, { success: false, error: err.message });
        }
      }
    }
`;

if (!content.includes('/api/attendance/history')) {
  content = content.replace("if (reqPath === '/api/attendance') {", historyEndpoint + "\n    if (reqPath === '/api/attendance') {");
  fs.writeFileSync('server.js', content);
}
console.log('Added history endpoint');
