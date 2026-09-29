const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const dashboardEndpoint = `
    // --- ADMIN DASHBOARD API ---
    if (reqPath === '/api/admin/dashboard') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        
        try {
          const students = await db.getStudents();
          const accounts = await db.getAccounts();
          const sessions = await db.getSessions();
          const attendance = await db.getAttendance();
          
          const today = new Date().toISOString().split('T')[0];
          
          // Filter today's sessions
          const todaySessions = sessions.filter(s => s.date === today);
          
          // Compute today's unique students present
          const todayLogs = attendance.filter(log => log.date === today);
          const presentRolls = new Set(todayLogs.map(log => log.rollNo.toUpperCase()));
          const presentCount = presentRolls.size;
          
          const totalStudents = students.filter(s => s.status !== 'inactive').length;
          const absentCount = Math.max(0, totalStudents - presentCount);
          
          // Enrich sessions with present/total counts
          const enrichedSessions = todaySessions.map(session => {
             const sessionLogs = todayLogs.filter(log => log.session === session.sessionId);
             const sessionPresentCount = new Set(sessionLogs.map(l => l.rollNo.toUpperCase())).size;
             const sectionTotal = students.filter(s => s.status !== 'inactive' && s.section && s.section.toUpperCase() === session.section.toUpperCase()).length;
             
             return {
                ...session,
                presentCount: sessionPresentCount,
                totalCount: sectionTotal
             };
          });
          
          // Sort by newest first
          enrichedSessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
          
          return sendJson(res, 200, {
             success: true,
             totalStudents,
             totalEmployees: accounts.length,
             totalSessions: todaySessions.length,
             presentCount,
             absentCount,
             sessionsToday: enrichedSessions
          });
          
        } catch (err) {
          return sendJson(res, 500, { success: false, error: err.message });
        }
      }
    }
`;

// Insert the dashboard endpoint before "3. ATTENDANCE LOGS API"
if (!content.includes('/api/admin/dashboard')) {
  content = content.replace('    // 3. ATTENDANCE LOGS API', dashboardEndpoint + '\n    // 3. ATTENDANCE LOGS API');
  fs.writeFileSync('server.js', content);
}
