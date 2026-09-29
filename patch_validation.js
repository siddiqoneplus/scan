const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

// 1. POST /api/roster - prevent mass assignment via `...s`
const rosterPostOld = `          return {
            ...s,
            branch,
            year,
            section,
            assignedTo: s.assignedTo || body.assignedTo || 'all'
          };`;

const rosterPostNew = `          return {
            rollNo: String(s.rollNo || '').trim().substring(0,50).toUpperCase(),
            name: String(s.name || '').trim().substring(0,100),
            status: s.status === 'inactive' ? 'inactive' : 'active',
            branch: branch ? String(branch).substring(0,50) : '',
            year: year ? String(year).substring(0,20) : '',
            section: section ? String(section).substring(0,50) : '',
            assignedTo: String(s.assignedTo || body.assignedTo || 'all').substring(0,50)
          };`;

if (server.includes(rosterPostOld)) {
    server = server.replace(rosterPostOld, rosterPostNew);
} else {
    console.log("Could not find POST /api/roster block");
}

// 2. POST /api/rules - prevent mass assignment
const rulesPostOld = `           const rule = await db.saveClassificationRule(body);`;
const rulesPostNew = `           const safeRule = {
              id: typeof body.id === 'string' ? body.id.substring(0,50) : ('rule-' + Date.now()),
              prefix: String(body.prefix || '').trim().substring(0, 50).toUpperCase(),
              startRange: parseInt(body.startRange) || 0,
              endRange: parseInt(body.endRange) || 999999,
              branch: String(body.branch || '').substring(0, 50),
              academicYear: String(body.academicYear || '').substring(0, 20),
              section: String(body.section || '').substring(0, 50),
              enabled: !!body.enabled
           };
           const rule = await db.saveClassificationRule(safeRule);`;

if (server.includes(rulesPostOld)) {
    server = server.replace(rulesPostOld, rulesPostNew);
} else {
    console.log("Could not find POST /api/rules block");
}

// 3. POST /api/sessions/start - add type and length limits
const sessionPostOld = `        if (!body.subject || !body.section || !body.period) {
           return sendJson(res, 400, { success: false, error: 'Missing required session fields' });
        }`;
const sessionPostNew = `        if (!body.subject || !body.section || !body.period || 
            typeof body.subject !== 'string' || typeof body.section !== 'string' || typeof body.period !== 'string' ||
            body.subject.length > 100 || body.section.length > 50 || body.period.length > 50) {
           return sendJson(res, 400, { success: false, error: 'Missing or invalid required session fields' });
        }`;

if (server.includes(sessionPostOld)) {
    server = server.replace(sessionPostOld, sessionPostNew);
} else {
    console.log("Could not find POST /api/sessions/start block");
}

// 4. GET /api/attendance/history - paginate safely
const histPageOld = `        const page = parseInt(urlParams.get('page')) || 1;
        const limit = parseInt(urlParams.get('limit')) || 50;`;
const histPageNew = `        let page = parseInt(urlParams.get('page')) || 1;
        let limit = parseInt(urlParams.get('limit')) || 50;
        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        if (limit > 500) limit = 500;`;

if (server.includes(histPageOld)) {
    server = server.replace(histPageOld, histPageNew);
} else {
    console.log("Could not find GET /api/attendance/history pagination block");
}

const auditPageOld = `          const page = parseInt(urlParams.get('page')) || 1;
          const limit = parseInt(urlParams.get('limit')) || 50;`;
const auditPageNew = `          let page = parseInt(urlParams.get('page')) || 1;
          let limit = parseInt(urlParams.get('limit')) || 50;
          if (page < 1) page = 1;
          if (limit < 1) limit = 50;
          if (limit > 500) limit = 500;`;

if (server.includes(auditPageOld)) {
    server = server.replace(auditPageOld, auditPageNew);
} else {
    console.log("Could not find GET /api/audit pagination block");
}

// 5. POST /api/events - prevent mass assignment
const eventPostOld = `        const event = await db.createEvent(body);`;
const eventPostNew = `        const safeEvent = {
           id: typeof body.id === 'string' ? body.id : ('event-' + Date.now()),
           name: String(body.name || 'Unnamed Event').substring(0, 100),
           date: String(body.date || new Date().toISOString().split('T')[0]).substring(0, 20),
           description: typeof body.description === 'string' ? body.description.substring(0, 500) : ''
        };
        const event = await db.createEvent(safeEvent);`;

if (server.includes(eventPostOld)) {
    server = server.replace(eventPostOld, eventPostNew);
} else {
    console.log("Could not find POST /api/events block");
}

// 6. POST /api/events/registrations - array validate
const regPostOld = `        if (!body.eventId || !body.rollNumbers) {
          return sendJson(res, 400, { success: false, error: 'eventId and rollNumbers[] are required' });
        }`;
const regPostNew = `        if (!body.eventId || !Array.isArray(body.rollNumbers)) {
          return sendJson(res, 400, { success: false, error: 'eventId and rollNumbers array are required' });
        }`;

if (server.includes(regPostOld)) {
    server = server.replace(regPostOld, regPostNew);
} else {
    console.log("Could not find POST /api/events/registrations block");
}

fs.writeFileSync('server.js', server);
console.log("Patched server.js with strict validation and sanitation.");
