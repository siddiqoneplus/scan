require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const [reqPath, queryString] = req.url.split('?');
  const params = new URLSearchParams(queryString || '');

  // -------------------------------------------------------------
  // API ROUTING
  // -------------------------------------------------------------
  if (reqPath.startsWith('/api/')) {

    // 0. DATABASE STATUS & CONFIGURATION API
    if (reqPath === '/api/db/status') {
      if (req.method === 'GET') {
        const status = await db.getStatus();
        return sendJson(res, 200, { success: true, db: status });
      }
    }

    if (reqPath === '/api/db/test') {
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const result = await db.testConnection(body.uri);
        return sendJson(res, 200, result);
      }
    }

    if (reqPath === '/api/db/configure') {
      if (req.method === 'POST') {
        const body = await parseBody(req);
        if (!body.uri) {
          return sendJson(res, 400, { success: false, error: 'MongoDB URI is required' });
        }
        const connected = await db.updateUriAndConnect(body.uri, body.dbName || 'smart_attendance');
        const status = await db.getStatus();
        return sendJson(res, 200, { success: connected, db: status });
      }
    }

    // 1. ROSTER API
    if (reqPath === '/api/roster') {
      if (req.method === 'GET') {
        const roster = await db.getStudents();
        const enriched = roster.map(s => ({
          ...s,
          assignedTo: s.assignedTo || 'all'
        }));
        return sendJson(res, 200, { success: true, students: enriched });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const studentsList = Array.isArray(body) ? body : (body.students || []);
        const normalized = studentsList.map(s => ({
          ...s,
          assignedTo: s.assignedTo || body.assignedTo || 'all'
        }));
        await db.saveStudents(normalized);
        return sendJson(res, 200, { success: true, count: normalized.length, students: normalized });
      }

      // DELETE: Clear ALL students from DB + local JSON
      if (req.method === 'DELETE') {
        await db.saveStudents([]);
        return sendJson(res, 200, { success: true, message: 'All students cleared', count: 0 });
      }
    }

    // 1b. DELETE INDIVIDUAL STUDENT
    if (reqPath === '/api/roster/student' && req.method === 'DELETE') {
      const body = await parseBody(req);
      const rollNo = body.rollNo || params.get('rollNo');
      if (!rollNo) {
        return sendJson(res, 400, { success: false, error: 'rollNo is required' });
      }
      const current = await db.getStudents();
      const filtered = current.filter(s => s.rollNo.toUpperCase() !== rollNo.toUpperCase());
      await db.saveStudents(filtered);
      return sendJson(res, 200, { success: true, removed: rollNo, remaining: filtered.length });
    }

    // 2. ROSTER IMPORT API
    if (reqPath === '/api/roster/import') {
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const incoming = Array.isArray(body) ? body : (body.students || []);
        const assignedTo = body.assignedTo || 'all';

        const result = await db.importStudents(incoming, assignedTo);
        return sendJson(res, 200, {
          success: true,
          importedCount: result.importedCount,
          total: result.total,
          students: result.students
        });
      }
    }

    // 3. ATTENDANCE LOGS API
    if (reqPath === '/api/attendance') {
      if (req.method === 'GET') {
        const logs = await db.getAttendance();
        return sendJson(res, 200, { success: true, logs });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);

        if (body.logs && Array.isArray(body.logs)) {
          await db.saveAttendance(body.logs);
          return sendJson(res, 200, { success: true, count: body.logs.length, logs: body.logs });
        } else if (body.record) {
          await db.addAttendanceRecord(body.record);
          const logs = await db.getAttendance();
          return sendJson(res, 200, { success: true, count: logs.length, logs });
        } else if (body.rollNo) {
          await db.addAttendanceRecord(body);
          const logs = await db.getAttendance();
          return sendJson(res, 200, { success: true, count: logs.length, logs });
        }

        const logs = await db.getAttendance();
        return sendJson(res, 200, { success: true, count: logs.length, logs });
      }

      if (req.method === 'DELETE') {
        const body = await parseBody(req);
        const recordId = body.id || params.get('id');

        if (!recordId) {
          return sendJson(res, 400, { success: false, error: 'Record ID required' });
        }

        const result = await db.deleteAttendanceRecord(recordId);
        return sendJson(res, 200, { success: true, message: result.message, count: result.count });
      }
    }

    // 4. ACCOUNTS API
    if (reqPath === '/api/accounts') {
      if (req.method === 'GET') {
        const accounts = await db.getAccounts();
        return sendJson(res, 200, { success: true, accounts });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const accounts = Array.isArray(body) ? body : (body.accounts || []);
        if (accounts.length > 0) {
          await db.saveAccounts(accounts);
        }
        return sendJson(res, 200, { success: true, count: accounts.length });
      }
    }

    // 5. BRANCH RULES API
    if (reqPath === '/api/rules') {
      if (req.method === 'GET') {
        const rules = await db.getRules();
        return sendJson(res, 200, { success: true, rules });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const rules = body.rules || body;
        await db.saveRules(rules);
        return sendJson(res, 200, { success: true, rules });
      }
    }

    return sendJson(res, 404, { success: false, error: 'API endpoint not found' });
  }

  // -------------------------------------------------------------
  // STATIC FILE SERVING
  // -------------------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? '/index.html' : reqPath);

  // Security check: ensure path stays within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// Initialize database connection (Atlas if MONGODB_URI set, else local JSON fallback)
db.connect().then(() => {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`Smart Attendance Server with MongoDB Atlas & REST API`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`Database Mode: ${process.env.MONGODB_URI ? 'MongoDB Atlas' : 'Local JSON Fallback'}`);
    console.log(`=======================================================`);
  });
}).catch(err => {
  console.error('Server startup error:', err);
  server.listen(PORT, () => {
    console.log(`Server listening in fallback mode at http://localhost:${PORT}`);
  });
});
