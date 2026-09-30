// PHASE 3: COMPREHENSIVE BASELINE TEST
// Tests every critical endpoint and traces the actual error

const http = require('http');
const results = [];

function log(category, name, passed, detail) {
  const status = passed ? '✅' : '❌';
  results.push({ category, name, passed, detail });
  console.log(`  ${status} [${category}] ${name}${detail ? ' — ' + detail : ''}`);
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('\n========================================');
  console.log('  PHASE 3: BASELINE STATUS TEST');
  console.log('========================================\n');

  // === HEALTH ===
  const health = await request('GET', '/api/health');
  log('SERVER', 'Health endpoint', health.status === 200, `status=${health.status}`);

  // === STATIC FILES ===
  const indexPage = await request('GET', '/');
  log('STATIC', 'index.html loads', indexPage.status === 200, `status=${indexPage.status}, type=${indexPage.headers['content-type']}`);

  const loginPage = await request('GET', '/login.html');
  log('STATIC', 'login.html loads', loginPage.status === 200, `status=${loginPage.status}`);

  const cssFile = await request('GET', '/css/style.css');
  log('STATIC', 'css/style.css loads', cssFile.status === 200, `status=${cssFile.status}`);

  const authJs = await request('GET', '/js/auth.js');
  log('STATIC', 'js/auth.js loads', authJs.status === 200, `status=${authJs.status}`);

  const appJs = await request('GET', '/js/app.js');
  log('STATIC', 'js/app.js loads', appJs.status === 200, `status=${appJs.status}`);

  const scannerJs = await request('GET', '/js/scanner.js');
  log('STATIC', 'js/scanner.js loads', scannerJs.status === 200, `status=${scannerJs.status}`);

  // === SECURITY: blocked files ===
  const envFile = await request('GET', '/.env');
  log('SECURITY', '.env blocked', envFile.status === 403, `status=${envFile.status}`);

  const serverJs = await request('GET', '/server.js');
  log('SECURITY', 'server.js blocked', serverJs.status === 403, `status=${serverJs.status}`);

  // === LOGIN ===
  const adminLogin = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
  log('AUTH', 'Admin login', adminLogin.status === 200 && adminLogin.body?.success && adminLogin.body?.token, 
    `status=${adminLogin.status}, success=${adminLogin.body?.success}, hasToken=${!!adminLogin.body?.token}, error=${adminLogin.body?.error || 'none'}`);

  const empLogin = await request('POST', '/api/login', { username: 'employee', password: 'emp123' });
  log('AUTH', 'Employee login', empLogin.status === 200 && empLogin.body?.success && empLogin.body?.token,
    `status=${empLogin.status}, success=${empLogin.body?.success}, hasToken=${!!empLogin.body?.token}, error=${empLogin.body?.error || 'none'}`);

  const badLogin = await request('POST', '/api/login', { username: 'admin', password: 'wrong' });
  log('AUTH', 'Bad password rejected', badLogin.status === 401, `status=${badLogin.status}`);

  const noAuth = await request('GET', '/api/roster');
  log('AUTH', 'No token = 401', noAuth.status === 401, `status=${noAuth.status}`);

  // Use whichever token succeeded
  const adminToken = adminLogin.body?.token;
  const empToken = empLogin.body?.token;
  const adminAuth = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
  const empAuth = empToken ? { Authorization: `Bearer ${empToken}` } : {};

  if (!adminToken) {
    console.log('\n  ⚠️  Admin login failed — skipping authenticated tests.\n');
    printSummary();
    return;
  }

  // === ROSTER ===
  const roster = await request('GET', '/api/roster', null, adminAuth);
  log('ROSTER', 'GET /api/roster', roster.status === 200 && roster.body?.success, 
    `status=${roster.status}, students=${roster.body?.students?.length}, error=${roster.body?.error || 'none'}`);

  // === ACCOUNTS ===
  const accounts = await request('GET', '/api/accounts', null, adminAuth);
  log('ACCOUNTS', 'GET /api/accounts', accounts.status === 200 && accounts.body?.success,
    `status=${accounts.status}, count=${accounts.body?.accounts?.length}, error=${accounts.body?.error || 'none'}`);
  
  // Verify passwords are NOT exposed
  if (accounts.body?.accounts) {
    const hasPassword = accounts.body.accounts.some(a => a.password);
    log('SECURITY', 'Passwords not exposed in GET /api/accounts', !hasPassword, 
      `passwordsExposed=${hasPassword}`);
  }

  // === RULES ===
  const rules = await request('GET', '/api/rules', null, adminAuth);
  log('RULES', 'GET /api/rules', rules.status === 200 && rules.body?.success,
    `status=${rules.status}, error=${rules.body?.error || 'none'}`);

  // === SESSIONS ===
  const sessions = await request('GET', '/api/sessions', null, adminAuth);
  log('SESSIONS', 'GET /api/sessions', sessions.status === 200 && sessions.body?.success,
    `status=${sessions.status}, count=${sessions.body?.sessions?.length}, error=${sessions.body?.error || 'none'}`);

  // === ATTENDANCE ===
  const attendance = await request('GET', '/api/attendance', null, adminAuth);
  log('ATTENDANCE', 'GET /api/attendance', attendance.status === 200 && attendance.body?.success,
    `status=${attendance.status}, count=${attendance.body?.logs?.length}, error=${attendance.body?.error || 'none'}`);

  // === HISTORY ===
  const history = await request('GET', '/api/attendance/history', null, adminAuth);
  log('HISTORY', 'GET /api/attendance/history', history.status === 200 && history.body?.success,
    `status=${history.status}, count=${history.body?.data?.length}, error=${history.body?.error || 'none'}`);

  // === ADMIN DASHBOARD ===
  const dashboard = await request('GET', '/api/admin/dashboard', null, adminAuth);
  log('DASHBOARD', 'GET /api/admin/dashboard', dashboard.status === 200 && dashboard.body?.success,
    `status=${dashboard.status}, error=${dashboard.body?.error || 'none'}`);

  // === EVENTS ===
  const events = await request('GET', '/api/events', null, adminAuth);
  log('EVENTS', 'GET /api/events', events.status === 200 && events.body?.success,
    `status=${events.status}, count=${events.body?.events?.length}, error=${events.body?.error || 'none'}`);

  // === AUDIT ===
  const audit = await request('GET', '/api/audit', null, adminAuth);
  log('AUDIT', 'GET /api/audit', audit.status === 200 && audit.body?.success,
    `status=${audit.status}, error=${audit.body?.error || 'none'}`);

  // === QR TOKENS ===
  const qrTokens = await request('GET', '/api/roster/qr-tokens', null, adminAuth);
  log('QR', 'GET /api/roster/qr-tokens', qrTokens.status === 200 && qrTokens.body?.success,
    `status=${qrTokens.status}, error=${qrTokens.body?.error || 'none'}`);

  // === EMPLOYEE AUTHORIZATION ===
  if (empToken) {
    const empAccounts = await request('GET', '/api/accounts', null, empAuth);
    log('AUTHZ', 'Employee blocked from /api/accounts', empAccounts.status === 403,
      `status=${empAccounts.status}`);

    const empDashboard = await request('GET', '/api/admin/dashboard', null, empAuth);
    log('AUTHZ', 'Employee blocked from /api/admin/dashboard', empDashboard.status === 403,
      `status=${empDashboard.status}`);
    
    const empRoster = await request('GET', '/api/roster', null, empAuth);
    log('AUTHZ', 'Employee can GET /api/roster (filtered)', empRoster.status === 200,
      `status=${empRoster.status}`);
  }

  // === CSP HEADER CHECK ===
  const cspHeader = indexPage.headers['content-security-policy'];
  log('SECURITY', 'CSP header present on HTML', !!cspHeader, `csp=${cspHeader ? 'yes' : 'missing'}`);

  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n========================================`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) {
    console.log('\n  FAILURES:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ [${r.category}] ${r.name} — ${r.detail}`);
    });
  }
  console.log('');
}

run().catch(e => console.error('Test runner crashed:', e));
