const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

// Seed default students with assignedTo: 'all'
const DEFAULT_STUDENTS = [
  { rollNo: '24A81A4401', name: 'Aarav Sharma', branch: 'Data Science (DS)', year: '2024 Batch (3rd Year)', assignedTo: 'all' },
  { rollNo: '24A81A6101', name: 'Charan Teja', branch: 'AIML (AI & Machine Learning)', year: '2024 Batch (3rd Year)', assignedTo: 'all' },
  { rollNo: '24A81A4301', name: 'Eshwar Kumar', branch: 'CAI (Computer Science & AI)', year: '2024 Batch (3rd Year)', assignedTo: 'all' },
  { rollNo: '25A81A4402', name: 'Bhavya Sri', branch: 'Data Science (DS)', year: '2025 Batch (2nd Year)', assignedTo: 'all' },
  { rollNo: '25A81A6102', name: 'Divya Reddy', branch: 'AIML (AI & Machine Learning)', year: '2025 Batch (2nd Year)', assignedTo: 'all' },
  { rollNo: '26A81A4403', name: 'Gautam Verma', branch: 'Data Science (DS)', year: '2026 Batch (1st Year)', assignedTo: 'all' },
  { rollNo: '26A81A6103', name: 'Fathima Begum', branch: 'AIML (AI & Machine Learning)', year: '2026 Batch (1st Year)', assignedTo: 'all' },
  { rollNo: '26A81A4303', name: 'Karthik Raja', branch: 'CAI (Computer Science & AI)', year: '2026 Batch (1st Year)', assignedTo: 'all' },
  { rollNo: '23A81A4415', name: 'Harika Nair', branch: 'Data Science (DS)', year: '2023 Batch (4th Year)', assignedTo: 'all' },
  { rollNo: '23A81A6120', name: 'Irfan Pasha', branch: 'AIML (AI & Machine Learning)', year: '2023 Batch (4th Year)', assignedTo: 'all' },
  { rollNo: '23A81A4310', name: 'Jyothi Priya', branch: 'CAI (Computer Science & AI)', year: '2023 Batch (4th Year)', assignedTo: 'all' }
];

const DEFAULT_ACCOUNTS = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: 'Administrator',
    role: 'admin',
    createdAt: new Date().toISOString()
  },
  {
    username: 'employee',
    password: 'emp123',
    displayName: 'Staff Member',
    role: 'employee',
    createdAt: new Date().toISOString()
  }
];

function readJsonFile(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filename, defaultValue);
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultValue;
  }
}

function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
    return false;
  }
}

// Initialize seed data if not present
readJsonFile('roster.json', DEFAULT_STUDENTS);
readJsonFile('accounts.json', DEFAULT_ACCOUNTS);
readJsonFile('attendance.json', []);
readJsonFile('rules.json', {});

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
    // 1. ROSTER API
    if (reqPath === '/api/roster') {
      if (req.method === 'GET') {
        const roster = readJsonFile('roster.json', DEFAULT_STUDENTS);
        // Ensure all students have assignedTo
        const enriched = roster.map(s => ({
          ...s,
          assignedTo: s.assignedTo || 'all'
        }));
        return sendJson(res, 200, { success: true, students: enriched });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const studentsList = Array.isArray(body) ? body : (body.students || []);
        // Normalize students list
        const normalized = studentsList.map(s => ({
          ...s,
          assignedTo: s.assignedTo || body.assignedTo || 'all'
        }));
        writeJsonFile('roster.json', normalized);
        return sendJson(res, 200, { success: true, count: normalized.length, students: normalized });
      }
    }

    // 2. ROSTER IMPORT API (Merges imported students with assignedTo: 'all')
    if (reqPath === '/api/roster/import') {
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const incoming = Array.isArray(body) ? body : (body.students || []);
        const assignedTo = body.assignedTo || 'all';

        let currentRoster = readJsonFile('roster.json', DEFAULT_STUDENTS);
        let importedCount = 0;

        incoming.forEach(student => {
          if (!student.rollNo) return;
          const cleanRoll = student.rollNo.trim().toUpperCase();
          const existingIdx = currentRoster.findIndex(s => s.rollNo.toUpperCase() === cleanRoll);

          const studentRecord = {
            rollNo: cleanRoll,
            name: student.name || `Student ${cleanRoll}`,
            branch: student.branch || 'General',
            year: student.year || '2024 Batch (3rd Year)',
            assignedTo: student.assignedTo || assignedTo,
            importedAt: new Date().toISOString()
          };

          if (existingIdx !== -1) {
            currentRoster[existingIdx] = { ...currentRoster[existingIdx], ...studentRecord };
          } else {
            currentRoster.push(studentRecord);
          }
          importedCount++;
        });

        writeJsonFile('roster.json', currentRoster);
        return sendJson(res, 200, {
          success: true,
          importedCount,
          total: currentRoster.length,
          students: currentRoster
        });
      }
    }

    // 3. ATTENDANCE LOGS API
    if (reqPath === '/api/attendance') {
      if (req.method === 'GET') {
        const logs = readJsonFile('attendance.json', []);
        return sendJson(res, 200, { success: true, logs });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        let currentLogs = readJsonFile('attendance.json', []);

        if (body.logs && Array.isArray(body.logs)) {
          // Replace all logs
          currentLogs = body.logs;
        } else if (body.record) {
          // Append single log
          currentLogs.unshift(body.record);
        } else if (body.rollNo) {
          currentLogs.unshift(body);
        }

        writeJsonFile('attendance.json', currentLogs);
        return sendJson(res, 200, { success: true, count: currentLogs.length, logs: currentLogs });
      }

      if (req.method === 'DELETE') {
        const body = await parseBody(req);
        const recordId = body.id || params.get('id');

        if (recordId === 'all') {
          writeJsonFile('attendance.json', []);
          return sendJson(res, 200, { success: true, message: 'All logs cleared', count: 0 });
        }

        if (recordId) {
          let currentLogs = readJsonFile('attendance.json', []);
          currentLogs = currentLogs.filter(r => r.id !== recordId);
          writeJsonFile('attendance.json', currentLogs);
          return sendJson(res, 200, { success: true, message: 'Record deleted', count: currentLogs.length });
        }

        return sendJson(res, 400, { success: false, error: 'Record ID required' });
      }
    }

    // 4. ACCOUNTS API
    if (reqPath === '/api/accounts') {
      if (req.method === 'GET') {
        const accounts = readJsonFile('accounts.json', DEFAULT_ACCOUNTS);
        return sendJson(res, 200, { success: true, accounts });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const accounts = Array.isArray(body) ? body : (body.accounts || []);
        if (accounts.length > 0) {
          writeJsonFile('accounts.json', accounts);
        }
        return sendJson(res, 200, { success: true, count: accounts.length });
      }
    }

    // 5. BRANCH RULES API
    if (reqPath === '/api/rules') {
      if (req.method === 'GET') {
        const rules = readJsonFile('rules.json', {});
        return sendJson(res, 200, { success: true, rules });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        const rules = body.rules || body;
        writeJsonFile('rules.json', rules);
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

server.listen(PORT, () => {
  console.log(`Smart Attendance Server with REST API running at http://localhost:${PORT}`);
});
