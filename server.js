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

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB limit

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        resolve({ __oversized: true });
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// --- ERROR HANDLING ---
function handleApiError(res, err) {
  console.error('[API Error]', err.message || err);
  const message = (err.message || 'Internal server error').replace(/mongodb|mongo|atlas|cluster|srv/gi, '[database]');
  const status = err.statusCode || 500;
  return sendJson(res, status, { success: false, error: message });
}

// --- AUDIT LOGGING ---
function logAudit(user, action, targetId, details) {
  const entry = {
    actor: user ? (user.displayName || user.username) : 'system',
    action,
    targetId: targetId || null,
    details: details || {},
    ip: 'server'
  };
  db.addAuditLog(entry).catch(e => console.warn('[Audit] Failed to log:', e.message));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}


// --- RATE LIMITING ENGINE ---
const rateLimits = new Map();

// Cleanup stale rate limits every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now - record.resetTime > 60000) {
      rateLimits.delete(key);
    }
  }
}, 10 * 60 * 1000);

function checkRateLimit(ip, endpointType, limit, windowMs) {
  const now = Date.now();
  const key = `${ip}_${endpointType}`;
  
  let record = rateLimits.get(key);
  if (!record || now - record.resetTime > windowMs) {
    record = { count: 1, resetTime: now };
    rateLimits.set(key, record);
    return false; // Not limited
  }
  
  record.count += 1;
  if (record.count > limit) {
    return true; // Limited
  }
  
  return false;
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
    // Check for oversized body early
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > MAX_BODY_SIZE) {
        return sendJson(res, 413, { success: false, error: 'Request body too large' });
      }
    }
    // Determine real IP accounting for Render proxy (x-forwarded-for)
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const clientIp = rawIp.split(',')[0].trim(); // Handle multiple proxies

    // 1. Auth Rate Limit (Login) - 5 req / minute
    if (reqPath === '/api/login') {
       if (checkRateLimit(clientIp, 'auth', process.env.RATE_LIMIT_AUTH || 5, 60000)) {
          return sendJson(res, 429, { success: false, error: 'Too many login attempts. Please try again later.' });
       }
    }
    
    // 2. Scanner Rate Limit (Attendance) - 120 req / minute
    else if (reqPath === '/api/attendance/scan') {
       if (checkRateLimit(clientIp, 'scan', process.env.RATE_LIMIT_SCAN || 120, 60000)) {
          return sendJson(res, 429, { success: false, error: 'Too many scans. Slow down.' });
       }
    }
    
    // 3. Expensive Reports (Export/History) - 20 req / minute
    else if (reqPath === '/api/attendance/history') {
       if (checkRateLimit(clientIp, 'export', process.env.RATE_LIMIT_EXPORT || 20, 60000)) {
          return sendJson(res, 429, { success: false, error: 'Report generation rate limited. Please try again later.' });
       }
    }
    
    // 4. Global API Limit - 300 req / minute
    else if (reqPath !== '/api/health') {
       if (checkRateLimit(clientIp, 'global', process.env.RATE_LIMIT_GLOBAL || 300, 60000)) {
          return sendJson(res, 429, { success: false, error: 'Too many API requests. Please try again later.' });
       }
    }


    // --- AUTHENTICATION ---
    
    // --- HEALTH CHECK (Render Cold Start & Ping) ---
    if (reqPath === '/api/health') {
      return sendJson(res, 200, { success: true, status: 'ok', timestamp: new Date().toISOString() });
    }

    if (reqPath === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const accounts = await db.getAccounts();
                  const bcrypt = require('bcryptjs');
      const account = accounts.find(a => a.username.toLowerCase() === (body.username || '').trim().toLowerCase());
      let isValid = false;
      
      if (account) {
         if (account.password && (account.password.startsWith('$2a$') || account.password.startsWith('$2b$'))) {
             isValid = await bcrypt.compare(body.password || '', account.password);
         } else if (account.password) {
             isValid = (account.password === body.password);
         }
      }
      
      if (!isValid) {
        return sendJson(res, 401, { success: false, error: 'Invalid username or password' });
      }

      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) throw new Error('JWT_SECRET missing');
      
      const token = jwt.sign({
        username: account.username,
        role: account.role,
        displayName: account.displayName
      }, JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' });

      return sendJson(res, 200, {
        success: true,
        token,
        session: {
          username: account.username,
          role: account.role,
          displayName: account.displayName
        }
      });
    }

    // --- AUTHENTICATION MIDDLEWARE ---
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET;
      
      if (!JWT_SECRET) {
         console.error('FATAL: JWT_SECRET environment variable is missing.');
         return sendJson(res, 500, { success: false, error: 'Server authentication configuration error.' });
      }
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        
        // Derive user state directly from the database to prevent privilege escalation
        // (i.e. if an admin revoked an employee's access, the JWT shouldn't be blindly trusted)
        const allAccounts = await db.getAccounts();
        const currentDbAccount = allAccounts.find(a => a.username === decoded.username);
        
        if (!currentDbAccount) {
            return sendJson(res, 401, { success: false, error: 'Account revoked or deleted.' });
        }
        
        user = {
            username: currentDbAccount.username,
            role: currentDbAccount.role,
            displayName: currentDbAccount.displayName
        };
        
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return sendJson(res, 401, { success: false, error: 'Session expired. Please log in again.' });
        }
        return sendJson(res, 401, { success: false, error: 'Invalid or tampered token.' });
      }
    } else {
      return sendJson(res, 401, { success: false, error: 'Authentication required' });
    }

    // --- AUTHORIZATION HELPERS ---
    const isAdmin = user.role === 'admin';
    const requireAdmin = () => {
      if (!isAdmin) {
        sendJson(res, 403, { success: false, error: 'Access denied: Admin role required' });
        return false;
      }
      return true;
    };

    // 0. DATABASE STATUS & CONFIGURATION API
    if (reqPath === '/api/roster') {
      
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
        
        const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;
        let page = parseInt(urlParams.get('page')) || 1;
        let limit = parseInt(urlParams.get('limit')) || 50;
        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        if (limit > 500) limit = 500;
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


      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        const studentsList = Array.isArray(body) ? body : (body.students || []);
        const rules = await db.getClassificationRules();
        
        const normalized = studentsList.map(s => {
          let classification = db.applyClassificationRules(s.rollNo, rules);
          let branch = s.branch;
          let year = s.year;
          let section = s.section;
          
          if (classification) {
            branch = classification.branch || branch;
            year = classification.academicYear || year;
            section = classification.section || section;
          }
          
          return {
            rollNo: String(s.rollNo || '').trim().substring(0,50).toUpperCase(),
            name: String(s.name || '').trim().substring(0,100),
            status: s.status === 'inactive' ? 'inactive' : 'active',
            branch: branch ? String(branch).substring(0,50) : '',
            year: year ? String(year).substring(0,20) : '',
            section: section ? String(section).substring(0,50) : '',
            assignedTo: String(s.assignedTo || body.assignedTo || 'all').substring(0,50)
          };
        });
        await db.saveStudents(normalized);
        return sendJson(res, 200, { success: true, count: normalized.length, students: normalized });
      }

      // DELETE: Clear ALL students from DB + local JSON


      if (req.method === 'DELETE') {
        if (!requireAdmin()) return;
        await db.saveStudents([]);
        return sendJson(res, 200, { success: true, message: 'All students cleared', count: 0 });
      }
    }

    
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

    // 1b. DELETE INDIVIDUAL STUDENT
    if (reqPath === '/api/roster/student' && req.method === 'DELETE') {
      if (!requireAdmin()) return;
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


    // --- CLASSIFICATION RULES API ---
    if (reqPath === '/api/rules') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        const rules = await db.getClassificationRules();
        return sendJson(res, 200, { success: true, rules });
      }
      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        try {
           const safeRule = {
              id: typeof body.id === 'string' ? body.id.substring(0,50) : ('rule-' + Date.now()),
              prefix: String(body.prefix || '').trim().substring(0, 50).toUpperCase(),
              startRange: parseInt(body.startRange) || 0,
              endRange: parseInt(body.endRange) || 999999,
              branch: String(body.branch || '').substring(0, 50),
              academicYear: String(body.academicYear || '').substring(0, 20),
              section: String(body.section || '').substring(0, 50),
              enabled: !!body.enabled
           };
           const rule = await db.saveClassificationRule(safeRule);
           return sendJson(res, 200, { success: true, rule });
        } catch (e) {
           return handleApiError(res, e);
        }
      }
      if (req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        if (!body.id) return sendJson(res, 400, { success: false, error: 'Rule ID required' });
        await db.deleteClassificationRule(body.id);
        return sendJson(res, 200, { success: true });
      }
    }

    // 2. ROSTER IMPORT API
    if (reqPath === '/api/roster/import') {
      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        const incoming = Array.isArray(body) ? body : (body.students || []);
        const assignedTo = body.assignedTo || 'all';

        try {
          const result = await db.importStudents(incoming, assignedTo);
          return sendJson(res, 200, {
            success: true,
            summary: {
              totalRows: result.total,
              importedCount: result.importedCount,
              duplicates: result.duplicates,
              invalidRows: result.invalidRows,
              skippedRows: result.skippedRows,
              errors: result.errors
            },
            students: result.students
          });
        } catch (e) {
          return handleApiError(res, e);
        }
      }
    }

    // 2b. SECURE QR TOKENS
    if (reqPath === '/api/roster/qr-tokens') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        const roster = await db.getStudents();
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) throw new Error('JWT_SECRET missing');
        
        const tokens = {};
        roster.forEach(s => {
          tokens[s.rollNo] = jwt.sign({ rollNo: s.rollNo, type: 'student_qr' }, JWT_SECRET);
        });
        return sendJson(res, 200, { success: true, tokens });
      }
    }


    // --- SESSIONS API ---
    if (reqPath === '/api/sessions') {
      if (req.method === 'GET') {
        let sessions = await db.getSessions();
        if (!isAdmin) {
           sessions = sessions.filter(s => s.employee === user.username);
        }
        return sendJson(res, 200, { success: true, sessions });
      }
    }
    
    if (reqPath === '/api/sessions/start') {
      if (req.method === 'POST') {
        if (!user) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
        const body = await parseBody(req);
        
        if (!body.subject || !body.section || !body.period || 
            typeof body.subject !== 'string' || typeof body.section !== 'string' || typeof body.period !== 'string' ||
            body.subject.length > 100 || body.section.length > 50 || body.period.length > 50) {
           return sendJson(res, 400, { success: false, error: 'Missing or invalid required session fields' });
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
           return sendJson(res, 403, { success: false, error: 'Cannot stop another employee\'s session' });
        }
        
        session.endTime = new Date().toISOString();
        session.status = 'completed';
        
        await db.saveSession(session);
        return sendJson(res, 200, { success: true, session });
      }
    }


    // --- ADMIN DASHBOARD API ---
        // --- AUDIT LOGS API ---
    if (reqPath === '/api/audit') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        try {
          const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;
          let page = parseInt(urlParams.get('page')) || 1;
          let limit = parseInt(urlParams.get('limit')) || 50;
          if (page < 1) page = 1;
          if (limit < 1) limit = 50;
          if (limit > 500) limit = 500;
          const actionFilter = urlParams.get('action');
          const actorFilter = urlParams.get('actor');
          
          let logs = await db.getAuditLogs();
          
          if (actionFilter) logs = logs.filter(l => l.action === actionFilter);
          if (actorFilter) logs = logs.filter(l => l.actor === actorFilter);
          
          const total = logs.length;
          const totalPages = Math.ceil(total / limit);
          const startIdx = (page - 1) * limit;
          const paginated = logs.slice(startIdx, startIdx + limit);
          
          return sendJson(res, 200, { success: true, data: paginated, pagination: { total, page, limit, totalPages } });
        } catch(e) {
          return handleApiError(res, e);
        }
      }
    }

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
          return handleApiError(res, err);
        }
      }
    }

    // 3. ATTENDANCE LOGS API
    
    // --- ATTENDANCE HISTORY (PAGINATED & FILTERED) ---
    if (reqPath === '/api/attendance/history') {
      if (req.method === 'GET') {
        const urlParams = new URL('http://127.0.0.1' + req.url).searchParams;
        let page = parseInt(urlParams.get('page')) || 1;
        let limit = parseInt(urlParams.get('limit')) || 50;
        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        if (limit > 500) limit = 500;
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
           return handleApiError(res, err);
        }
      }
    }

    if (reqPath === '/api/attendance') {
      // Helper function to get allowed roll numbers for employee
      const getAllowedRolls = async () => {
        if (isAdmin) return null;
        const roster = await db.getStudents();
        return new Set(
          roster.filter(s => (s.assignedTo || 'all') === 'all' || s.assignedTo === user.username)
                .map(s => s.rollNo.toUpperCase())
        );
      };

      if (req.method === 'GET') {
        let logs = await db.getAttendance();
        const allowedRolls = await getAllowedRolls();
        
        if (allowedRolls !== null) {
          logs = logs.filter(log => allowedRolls.has((log.rollNo || '').toUpperCase()));
        }
        
        return sendJson(res, 200, { success: true, logs });
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        
        if (!body || typeof body !== 'object') {
          return sendJson(res, 400, { success: false, error: 'Invalid request body' });
        }

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
          
          const cleanRoll = reqRecord.rollNo.toUpperCase();
          const student = roster.find(s => s.rollNo.toUpperCase() === cleanRoll);
          if (!student) throw new Error(`Student ${cleanRoll} not found`);
          if (student.status === 'inactive') throw new Error(`Student ${cleanRoll} is inactive`);
          if (allowedRolls !== null && !allowedRolls.has(cleanRoll)) {
             throw new Error(`Unauthorized for student ${cleanRoll}`);
          }
          if (reqRecord.section && student.section && student.section.toUpperCase() !== reqRecord.section.toUpperCase()) {
             throw new Error(`Student ${cleanRoll} does not match section ${reqRecord.section}`);
          }
          
          // Server generates ID — never trust client-provided IDs
          const VALID_STATUSES = ['Present', 'Absent', 'Late'];
          const clientStatus = typeof reqRecord.status === 'string' ? reqRecord.status : 'Present';
          return {
            id: 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            rollNo: student.rollNo,
            name: student.name,
            branch: student.branch,
            year: student.year,
            section: student.section || '',
            session: reqRecord.session,
            date: today,
            timestamp: nowTime,
            eventId: reqRecord.eventId || null,
            status: VALID_STATUSES.includes(clientStatus) ? clientStatus : 'Present',
            walkIn: !!reqRecord.walkIn,
            markedBy: user.displayName || user.username
          };
        };

        if (body.record) {
           try {
              const secureRecord = processRecord(body.record);
              const isDuplicate = existingLogs.find(r => r.rollNo === secureRecord.rollNo && r.date === today && r.session === secureRecord.session && r.eventId === secureRecord.eventId);
              if (isDuplicate) return sendJson(res, 400, { success: false, error: 'Duplicate attendance' });
              
              await db.addAttendanceRecord(secureRecord);
              return sendJson(res, 200, { success: true, message: 'Attendance recorded' });
           } catch (e) {
              if (e.message === 'DUPLICATE_ATTENDANCE') {
                return sendJson(res, 400, { success: false, reason: 'duplicate scan', error: 'Attendance already marked.' });
              }
              return handleApiError(res, e);
           }
        } 
        else if (body.logs && Array.isArray(body.logs)) {
           try {
              const secureLogs = body.logs.map(processRecord);
              const newValidLogs = [];
              for (const sl of secureLogs) {
                 const isDup = existingLogs.find(r => r.rollNo === sl.rollNo && r.date === today && r.session === sl.session && r.eventId === sl.eventId);
                 if (!isDup) newValidLogs.push(sl);
              }
              if (newValidLogs.length > 0) {
                 await db.saveAttendance([...existingLogs, ...newValidLogs]);
              }
               return sendJson(res, 200, { success: true, message: 'Batch attendance processed' });
           } catch (e) {
              return handleApiError(res, e);
           }
        } else if (body.rollNo && body.session) {
           try {
              const secureRecord = processRecord(body);
              const isDuplicate = existingLogs.find(r => r.rollNo === secureRecord.rollNo && r.date === today && r.session === secureRecord.session && r.eventId === secureRecord.eventId);
              if (isDuplicate) return sendJson(res, 400, { success: false, error: 'Duplicate attendance' });
              await db.addAttendanceRecord(secureRecord);
               return sendJson(res, 200, { success: true, message: 'Attendance recorded' });
           } catch (e) {
              if (e.message === 'DUPLICATE_ATTENDANCE') {
                return sendJson(res, 400, { success: false, reason: 'duplicate scan', error: 'Attendance already marked.' });
              }
              return handleApiError(res, e);
           }
        } else {
           return sendJson(res, 400, { success: false, error: 'Invalid payload format' });
        }
      }

      if (req.method === 'DELETE') {
        const body = await parseBody(req);
        const recordId = body.id || params.get('id') || 'all';

        if (recordId === 'all') {
          if (!requireAdmin()) return;
        } else {
          // Employee can delete individual record, but must own the student
          const allowedRolls = await getAllowedRolls();
          if (allowedRolls !== null) {
            const logs = await db.getAttendance();
            const record = logs.find(r => r.id === recordId);
            if (!record || !allowedRolls.has((record.rollNo || '').toUpperCase())) {
              return sendJson(res, 403, { success: false, error: 'Access denied: unauthorized student roll no' });
            }
          }
        }

        const result = await db.deleteAttendanceRecord(recordId);
        logAudit(user, 'attendance deleted', recordId);
        return sendJson(res, 200, { success: true, message: result.message, count: result.count });
      }
    }

    // 3a. SECURE QR SCAN ENDPOINT
    if (reqPath === '/api/attendance/scan' && req.method === 'POST') {
      const body = await parseBody(req);
      const { qrPayload, eventId } = body;
      const sessionName = body.session || body.sessionName;
      
      if (!qrPayload) return sendJson(res, 400, { success: false, reason: 'invalid QR', error: 'Missing QR Payload' });

      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) throw new Error('JWT_SECRET missing');
      
      let decoded;
      try {
        decoded = jwt.verify(qrPayload, JWT_SECRET);
        if (decoded.type !== 'student_qr') throw new Error('Invalid token type');
      } catch (err) {
        return sendJson(res, 400, { success: false, reason: 'invalid QR', error: 'Invalid or forged QR Code. Legacy codes are not accepted.' });
      }

      const rollNo = decoded.rollNo;
      const roster = await db.getStudents();
      const student = roster.find(s => s.rollNo.toUpperCase() === rollNo.toUpperCase());

      if (!student) {
        return sendJson(res, 404, { success: false, reason: 'unregistered student', error: `Student ${rollNo} not found in database.` });
      }
      
      // "Verify the student is active"
      if (student.status === 'inactive') {
         return sendJson(res, 403, { success: false, reason: 'inactive student', error: `Student ${rollNo} is marked inactive.` });
      }

      const allowedRolls = async () => {
        if (isAdmin) return null;
        return new Set(
          roster.filter(s => (s.assignedTo || 'all') === 'all' || s.assignedTo === user.username)
                .map(s => s.rollNo.toUpperCase())
        );
      };
      
      const rolls = await allowedRolls();
      if (rolls !== null && !rolls.has(rollNo.toUpperCase())) {
        return sendJson(res, 403, { success: false, reason: 'unauthorized student', error: `You are not authorized to mark attendance for ${rollNo}.` });
      }

      // Active session verify (IDOR & Auth Check)
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
         return sendJson(res, 403, { success: false, reason: 'unauthorized session', error: 'You are not authorized to mark attendance for another employee\'s session.' });
      }
      
      // Override body.section with the actual session's section to ensure accurate data integrity
      body.section = sessionObj.section;
      
      // Verify section if specified
      if (body.section && student.section && student.section.toUpperCase() !== body.section.toUpperCase()) {
        return sendJson(res, 403, { success: false, reason: 'unauthorized student', error: `Student ${rollNo} does not belong to section ${body.section}.` });
      }

      // Check Duplicate
      const logs = await db.getAttendance();
      const today = new Date().toISOString().split('T')[0];
      const existing = logs.find(r => 
         r.rollNo.toUpperCase() === rollNo.toUpperCase() && 
         (r.date === today || !r.date) && 
         r.session === sessionName && 
         (eventId ? r.eventId === eventId : true)
      );

      if (existing) {
        return sendJson(res, 200, { success: false, reason: 'duplicate scan', error: `Already marked present`, record: existing, student });
      }

      // Create record
      const now = new Date();
      const record = {
        id: 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        rollNo: student.rollNo,
        name: student.name,
        branch: student.branch,
        year: student.year,
        section: student.section || '',
        session: sessionName,
        date: today,
        timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        eventId: eventId || null,
        markedBy: user.displayName || user.username
      };

      try {
        await db.addAttendanceRecord(record);
        return sendJson(res, 200, { success: true, reason: 'successful scan', record, student });
      } catch (e) {
        if (e.message === 'DUPLICATE_ATTENDANCE') {
          return sendJson(res, 200, { success: false, reason: 'duplicate scan', error: 'Attendance already marked.', student });
        }
        return handleApiError(res, e);
      }
    }

    // 3b. ATOMIC PURGE: Clear ALL students AND attendance permanently
    if (reqPath === '/api/admin/clear-all' && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!requireAdmin()) return;
      const result = await db.clearAllSystemData();
      return sendJson(res, 200, { success: true, message: 'All system data permanently erased', ...result });
    }

    // 4. ACCOUNTS API
    if (reqPath === '/api/accounts') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        const accounts = await db.getAccounts();
        // Prevent exposing passwords in API responses (Rule 12)
        const safeAccounts = accounts.map(({ password, ...safe }) => safe);
        return sendJson(res, 200, { success: true, accounts: safeAccounts });
      }

      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        try { // accounts-post
        const incomingAccounts = Array.isArray(body) ? body : (body.accounts || []);
        if (incomingAccounts.length > 0) {
          // Merge existing passwords to prevent wiping them since GET strips passwords
          const existingAccounts = await db.getAccounts();
          const existingMap = new Map(existingAccounts.map(a => [a.username.toLowerCase(), a.password]));
          
          const bcrypt = require('bcryptjs');
          const mergedAccounts = await Promise.all(incomingAccounts.map(async acc => {
             const existingPass = existingMap.get(acc.username.toLowerCase());
             
             let finalPassword = existingPass;
             if (acc.password && acc.password.trim() !== '') {
                 if (acc.password.length < 6) {
                    throw new Error('Password must be at least 6 characters long.');
                 }
                 finalPassword = await bcrypt.hash(acc.password, 10);
             } else if (!existingPass) {
                 throw new Error(`Password is required for new account: ${acc.username}`);
             }
             
             return {
               username: String(acc.username || '').trim().toLowerCase().substring(0, 50),
               displayName: String(acc.displayName || acc.username || '').substring(0, 100),
               role: acc.role === 'admin' ? 'admin' : 'employee',
               createdAt: acc.createdAt || new Date().toISOString(),
               password: finalPassword
             };
          }));
          
          await db.saveAccounts(mergedAccounts);
        }
        return sendJson(res, 200, { success: true, count: incomingAccounts.length });
        } catch(e) { return handleApiError(res, e); }
      }
    }

    // 5. BRANCH RULES API (merged into Classification Rules at /api/rules above)

    // 6. EVENTS API
    if (reqPath === '/api/events') {
      if (req.method === 'GET') {
        const events = await db.getEvents();
        return sendJson(res, 200, { success: true, events });
      }

      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        if (body.action === 'update' && body.eventId) {
          const safeUpdates = {};
          if (typeof body.updates === 'object' && body.updates) {
            if (typeof body.updates.name === 'string') safeUpdates.name = body.updates.name.substring(0, 100);
            if (typeof body.updates.date === 'string') safeUpdates.date = body.updates.date.substring(0, 20);
            if (typeof body.updates.description === 'string') safeUpdates.description = body.updates.description.substring(0, 500);
          }
          const updated = await db.updateEvent(body.eventId, safeUpdates);
          return sendJson(res, 200, { success: !!updated, event: updated });
        }
        const safeEvent = {
           id: typeof body.id === 'string' ? body.id : ('event-' + Date.now()),
           name: String(body.name || 'Unnamed Event').substring(0, 100),
           date: String(body.date || new Date().toISOString().split('T')[0]).substring(0, 20),
           description: typeof body.description === 'string' ? body.description.substring(0, 500) : ''
        };
        const event = await db.createEvent(safeEvent);
        return sendJson(res, 201, { success: true, event });
      }

      if (req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        const eventId = body.eventId || params.get('eventId');
        if (!eventId) {
          return sendJson(res, 400, { success: false, error: 'eventId is required' });
        }
        const result = await db.deleteEvent(eventId);
        return sendJson(res, 200, { success: true, message: 'Event deleted', ...result });
      }
    }

    // 7. EVENT REGISTRATIONS API
    if (reqPath === '/api/events/registrations') {
      if (req.method === 'GET') {
        const eventId = params.get('eventId');
        if (!eventId) {
          return sendJson(res, 400, { success: false, error: 'eventId query param is required' });
        }
        const rollNumbers = await db.getEventRegistrations(eventId);
        return sendJson(res, 200, { success: true, eventId, rollNumbers, count: rollNumbers.length });
      }

      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        if (!body.eventId || !Array.isArray(body.rollNumbers)) {
          return sendJson(res, 400, { success: false, error: 'eventId and rollNumbers array are required' });
        }
        const result = await db.registerStudentsToEvent(body.eventId, body.rollNumbers);
        return sendJson(res, 200, { success: true, ...result });
      }

      if (req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        if (!body.eventId || !body.rollNo) {
          return sendJson(res, 400, { success: false, error: 'eventId and rollNo are required' });
        }
        const result = await db.unregisterStudentFromEvent(body.eventId, body.rollNo);
        return sendJson(res, 200, { success: true, ...result });
      }
    }

    return sendJson(res, 404, { success: false, error: 'API endpoint not found' });
  }

  // -------------------------------------------------------------
  // STATIC FILE SERVING
  // -------------------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? '/index.html' : reqPath);

  // Security: normalize and ensure path stays within PUBLIC_DIR
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Security: Block access to sensitive files and directories
  const BLOCKED_PATHS = ['.env', '.gitignore', 'server.js', 'db.js', 'package.json', 'package-lock.json'];
  const BLOCKED_DIRS = ['data', 'node_modules', '.git'];
  const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map']);

  const relative = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, '/');

  // Block specific files in root
  if (BLOCKED_PATHS.includes(relative.toLowerCase())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Block entire directories
  const topDir = relative.split('/')[0].toLowerCase();
  if (BLOCKED_DIRS.includes(topDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Block dotfiles
  if (relative.startsWith('.') || relative.includes('/.')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Block root-level .js files (server code) — only allow js/ subdirectory
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' && !relative.startsWith('js/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Block unknown file extensions
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

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
