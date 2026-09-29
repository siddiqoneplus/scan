const fs = require('fs');

// 1. Generate and append JWT_SECRET to .env if not present
let envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
if (!envContent.includes('JWT_SECRET')) {
    const crypto = require('crypto');
    const secret = crypto.randomBytes(64).toString('hex');
    fs.appendFileSync('.env', `\n# JWT Secret Key for Authentication\nJWT_SECRET=${secret}\n`);
    console.log('Appended secure JWT_SECRET to .env');
}

// 2. Patch server.js safely
let server = fs.readFileSync('server.js', 'utf8');

const loginJwtStart = "      const jwt = require('jsonwebtoken');";
const loginJwtEnd = "      return sendJson(res, 200, {";

const loginJwtBlock = `      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) throw new Error('JWT_SECRET missing');
      
      const token = jwt.sign({
        username: account.username,
        role: account.role,
        displayName: account.displayName
      }, JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' });

`;

const s1 = server.indexOf(loginJwtStart);
const e1 = server.indexOf(loginJwtEnd, s1);

if (s1 !== -1 && e1 !== -1) {
    server = server.substring(0, s1) + loginJwtBlock + server.substring(e1);
} else {
    console.error('Could not find login JWT block');
}


const middlewareStart = "    const authHeader = req.headers.authorization;";
const middlewareEnd = "    // --- AUTHORIZATION HELPERS ---";

const middlewareBlock = `    const authHeader = req.headers.authorization;
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

`;

const s2 = server.indexOf(middlewareStart);
const e2 = server.indexOf(middlewareEnd, s2);

if (s2 !== -1 && e2 !== -1) {
    server = server.substring(0, s2) + middlewareBlock + server.substring(e2);
} else {
    console.error('Could not find middleware block');
}


const cspStart = "    res.writeHead(200, {";
const cspEnd = "    const stream = fs.createReadStream(filePath);";

// Find static file serving block
const s3 = server.lastIndexOf(cspStart);
const e3 = server.indexOf(cspEnd, s3);

if (s3 !== -1 && e3 !== -1) {
    const cspBlock = `    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
    });

`;
    server = server.substring(0, s3) + cspBlock + server.substring(e3);
} else {
    console.error('Could not find CSP block');
}


// Final sanity check for QR tokens!
// Wait! There is another jsonwebtoken call in GET /api/roster/qr-tokens
const qrTokenRegex = /const JWT_SECRET = process\.env\.JWT_SECRET \|\| 'fallback-secret-for-dev';/g;
server = server.replace(qrTokenRegex, "const JWT_SECRET = process.env.JWT_SECRET; if (!JWT_SECRET) throw new Error('JWT_SECRET missing');");


fs.writeFileSync('server.js', server);
console.log('Patched server.js for JWT hardening and CSP');
