const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

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

async function runTests() {
  console.log("--- Starting Robust Duplicate Attendance Tests ---");

  // 1. Setup Data
  let res = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const adminToken = res.body.token;
  
  await request('POST', '/api/admin/clear-all', {}, adminToken);

  await request('POST', '/api/roster/import', {
    students: [
      { rollNo: 'DUP1', name: 'Duplicate 1', assignedTo: 'all' }
    ]
  }, adminToken);

  res = await request('POST', '/api/login', { username: 'employee', password: 'emp123' });
  const empToken = res.body.token;

  const qrPayload = jwt.sign({ rollNo: 'DUP1', type: 'student_qr' }, process.env.JWT_SECRET || 'fallback-secret-for-dev');

  // Test 1: First Scan
  res = await request('POST', '/api/attendance/scan', { qrPayload, sessionName: 'Morning' }, empToken);
  console.log("Test 1 (First Scan):", res.status === 200 && res.body.reason === 'successful scan' ? "PASS" : `FAIL (${res.status} ${res.body.reason})`);
  
  // Test 2: Second Scan (Same Student, Same Session)
  res = await request('POST', '/api/attendance/scan', { qrPayload, sessionName: 'Morning' }, empToken);
  console.log("Test 2 (Second Scan):", res.status === 200 && res.body.reason === 'duplicate scan' && res.body.error === 'Attendance already marked.' ? "PASS" : `FAIL (${res.status} ${res.body.reason} ${res.body.error})`);

  // Test 3: Same Student in Different Session
  res = await request('POST', '/api/attendance/scan', { qrPayload, sessionName: 'Afternoon' }, empToken);
  console.log("Test 3 (Different Session):", res.status === 200 && res.body.reason === 'successful scan' ? "PASS" : `FAIL (${res.status} ${res.body.reason})`);

  // Test 4: Race Condition (Rapid Scans)
  // We will fire two requests simultaneously, wait for them to finish.
  // One should succeed (or already fail if we use 'Afternoon', so let's use 'Evening').
  const req1 = request('POST', '/api/attendance/scan', { qrPayload, sessionName: 'Evening' }, empToken);
  const req2 = request('POST', '/api/attendance/scan', { qrPayload, sessionName: 'Evening' }, empToken);
  
  const results = await Promise.all([req1, req2]);
  
  let successCount = 0;
  let dupCount = 0;
  for (const r of results) {
    if (r.status === 200 && r.body.reason === 'successful scan') successCount++;
    if (r.status === 200 && r.body.reason === 'duplicate scan' && r.body.error === 'Attendance already marked.') dupCount++;
  }
  
  console.log("Test 4 Results:", results.map(r => ({ status: r.status, body: r.body })));
  console.log("Test 4 (Race Condition Rapid Scans):", successCount === 1 && dupCount === 1 ? "PASS" : `FAIL (Successes: ${successCount}, Duplicates: ${dupCount})`);

  // Test 5: Same student from two devices (manual entry via /api/attendance)
  const req3 = request('POST', '/api/attendance', { rollNo: 'DUP1', session: 'Night' }, empToken);
  const req4 = request('POST', '/api/attendance', { rollNo: 'DUP1', session: 'Night' }, adminToken); // Simulated other device with different token

  const resultsManual = await Promise.all([req3, req4]);
  let manualSuccess = 0;
  let manualDup = 0;
  for (const r of resultsManual) {
    if (r.status === 200 && r.body.success === true) manualSuccess++;
    if (r.status === 400 && r.body.error === 'Attendance already marked.') manualDup++;
  }

  console.log("Test 5 Results:", resultsManual.map(r => ({ status: r.status, body: r.body })));
  console.log("Test 5 (Two devices manual entry race):", manualSuccess === 1 && manualDup === 1 ? "PASS" : `FAIL (Successes: ${manualSuccess}, Duplicates: ${manualDup})`);

  // Verify total records in DB for DUP1
  const logsRes = await request('GET', '/api/attendance', null, adminToken);
  const dup1Logs = logsRes.body.logs.filter(l => l.rollNo === 'DUP1');
  console.log("Total DB Records for DUP1 (Expected 4):", dup1Logs.length === 4 ? "PASS" : `FAIL (Found ${dup1Logs.length})`);

  console.log("--- Tests Complete ---");
}

runTests();
