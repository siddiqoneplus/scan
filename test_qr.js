const http = require('http');
const jwt = require('jsonwebtoken');

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {}
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runQrTests() {
  console.log("--- Starting Secure QR Tests ---");

  // 1. Admin Login to seed data
  let res = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const adminToken = res.body.token;

  await request('POST', '/api/roster', {
    students: [
      { rollNo: 'QR1', name: 'Valid Student', assignedTo: 'all' },
      { rollNo: 'QR2', name: 'Inactive Student', assignedTo: 'all', status: 'inactive' }
    ]
  }, adminToken);

  // 2. Fetch Secure Tokens (Admin)
  res = await request('GET', '/api/roster/qr-tokens', null, adminToken);
  const secureTokenQR1 = res.body.tokens['QR1'];

  // 3. Employee Login to scan
  res = await request('POST', '/api/login', { username: 'employee', password: 'emp123' });
  const empToken = res.body.token;

  // Test 1: Valid Scan
  res = await request('POST', '/api/attendance/scan', { qrPayload: secureTokenQR1, sessionName: 'Attendance' }, empToken);
  console.log("Valid Secure Scan (QR1):", res.status === 200 && res.body.success ? "PASS" : "FAIL (" + res.status + " " + res.body.reason + ")");

  // Test 2: Duplicate Scan (same payload)
  res = await request('POST', '/api/attendance/scan', { qrPayload: secureTokenQR1, sessionName: 'Attendance' }, empToken);
  console.log("Duplicate Scan (QR1):", res.status === 200 && res.body.reason === 'duplicate scan' ? "PASS" : "FAIL");

  // Test 3: Manually Modified/Forged Payload
  const forgedPayload = secureTokenQR1.slice(0, -5) + 'xxxxx';
  res = await request('POST', '/api/attendance/scan', { qrPayload: forgedPayload, sessionName: 'Attendance' }, empToken);
  console.log("Forged QR Payload:", res.status === 400 && res.body.reason === 'invalid QR' ? "PASS" : "FAIL");

  // Test 4: Inactive Student
  const inactivePayload = jwt.sign({ rollNo: 'QR2', type: 'student_qr' }, process.env.JWT_SECRET || 'fallback-secret-for-dev');
  res = await request('POST', '/api/attendance/scan', { qrPayload: inactivePayload, sessionName: 'Attendance' }, empToken);
  console.log("Inactive Student:", res.status === 403 && res.body.reason === 'inactive student' ? "PASS" : "FAIL");

  // Test 5: No Active Session
  res = await request('POST', '/api/attendance/scan', { qrPayload: secureTokenQR1 }, empToken);
  console.log("No Active Session specified:", res.status === 400 && res.body.reason === 'no active session' ? "PASS" : "FAIL");

  console.log("--- QR Tests Complete ---");
}

runQrTests();
