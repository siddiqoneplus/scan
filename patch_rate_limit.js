const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

const rateLimitLogic = `
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
  const key = \`\${ip}_\${endpointType}\`;
  
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
`;

if (!server.includes('checkRateLimit')) {
    server = server.replace('const server = http.createServer(async (req, res) => {', rateLimitLogic + '\nconst server = http.createServer(async (req, res) => {');
}

const reqPathBlock = `
  if (reqPath.startsWith('/api/')) {
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
`;

if (!server.includes("const rawIp = req.headers['x-forwarded-for']")) {
    server = server.replace("  if (reqPath.startsWith('/api/')) {", reqPathBlock);
}

fs.writeFileSync('server.js', server);
console.log('Patched server.js with rate limiting engine.');
