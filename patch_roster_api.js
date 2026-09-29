const fs = require('fs');

// --- 1. Patch server.js ---
let server = fs.readFileSync('server.js', 'utf8');

const getRosterAPI = `
      if (req.method === 'GET') {
        let roster = await db.getStudents();
        let enriched = roster.map(s => ({
          ...s,
          assignedTo: s.assignedTo || 'all',
          status: s.status || 'active'
        }));
        
        if (!isAdmin) {
          enriched = enriched.filter(s => s.assignedTo === 'all' || s.assignedTo === user.username);
        }
        
        const urlParams = new URL('http://localhost' + req.url).searchParams;
        const page = parseInt(urlParams.get('page')) || 1;
        const limit = parseInt(urlParams.get('limit')) || 50;
        const query = (urlParams.get('query') || '').toLowerCase().trim();
        const branch = urlParams.get('branch') || 'ALL';
        const year = urlParams.get('year') || 'ALL';
        const assigned = urlParams.get('assigned') || 'ALL';
        const section = urlParams.get('section') || 'ALL';
        
        if (query) {
           enriched = enriched.filter(s => s.rollNo.toLowerCase().includes(query) || s.name.toLowerCase().includes(query));
        }
        if (branch !== 'ALL') {
           enriched = enriched.filter(s => s.branch === branch || s.branch.includes(branch) || branch.includes(s.branch));
        }
        if (year !== 'ALL') {
           enriched = enriched.filter(s => s.year === year || s.year.includes(year) || year.includes(s.year));
        }
        if (assigned !== 'ALL') {
           enriched = enriched.filter(s => (s.assignedTo || 'all').toLowerCase() === assigned.toLowerCase());
        }
        if (section !== 'ALL') {
           enriched = enriched.filter(s => (s.section || '').toUpperCase() === section.toUpperCase());
        }
        
        // Always sort by rollNo
        enriched.sort((a,b) => a.rollNo.localeCompare(b.rollNo));
        
        const total = enriched.length;
        const totalPages = Math.ceil(total / limit);
        const startIdx = (page - 1) * limit;
        const paginated = enriched.slice(startIdx, startIdx + limit);
        
        return sendJson(res, 200, { success: true, students: paginated, pagination: { total, page, limit, totalPages } });
      }
`;

// Replace the existing GET /api/roster block
const oldGetRosterRegex = /if \(req\.method === 'GET'\) \{[\s\S]*?return sendJson\(res, 200, \{ success: true, students: enriched \}\);\n\s*\}/;
server = server.replace(oldGetRosterRegex, getRosterAPI);

// Add PATCH /api/roster/student for status updates (activate/deactivate)
const patchStudentAPI = `
    if (reqPath === '/api/roster/student' && req.method === 'PATCH') {
      if (!requireAdmin()) return;
      const body = await parseBody(req);
      const rollNo = body.rollNo;
      if (!rollNo) return sendJson(res, 400, { success: false, error: 'rollNo is required' });
      
      const current = await db.getStudents();
      const studentIdx = current.findIndex(s => s.rollNo.toUpperCase() === rollNo.toUpperCase());
      if (studentIdx === -1) return sendJson(res, 404, { success: false, error: 'Student not found' });
      
      if (body.action === 'toggle_status') {
         current[studentIdx].status = current[studentIdx].status === 'inactive' ? 'active' : 'inactive';
         logAudit(user, 'student ' + current[studentIdx].status, rollNo);
      } else if (body.action === 'edit') {
         current[studentIdx] = { ...current[studentIdx], ...body.updates };
         logAudit(user, 'student updated', rollNo);
      }
      
      await db.saveStudents(current);
      return sendJson(res, 200, { success: true, student: current[studentIdx] });
    }
`;
if (!server.includes("req.method === 'PATCH'")) {
   server = server.replace("if (reqPath === '/api/roster/student' && req.method === 'DELETE')", patchStudentAPI + "\n    if (reqPath === '/api/roster/student' && req.method === 'DELETE')");
}

fs.writeFileSync('server.js', server);
console.log('Patched server.js for paginated roster');
