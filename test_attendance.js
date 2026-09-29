const http = require('http');

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
  console.log("--- Starting Attendance POST API Tests ---");

  // 1. Setup Data
  let res = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
  const adminToken = res.body.token;

  // Clear existing attendance and students first
  await request('POST', '/api/admin/clear-all', {}, adminToken);

  // Setup Data
  await request('POST', '/api/roster/import', {
    students: [
      { rollNo: 'M1', name: 'Manual 1', assignedTo: 'employee', section: 'A' },
      { rollNo: 'M2', name: 'Manual 2', assignedTo: 'admin', section: 'B' },
      { rollNo: 'M3', name: 'Manual 3', assignedTo: 'employee', status: 'inactive' }
    ]
  }, adminToken);

  res = await request('POST', '/api/login', { username: 'employee', password: 'emp123' });
  const empToken = res.body.token;

  // Test 1: Forging Timestamp & Date (Should be ignored by server)
  res = await request('POST', '/api/attendance', {
    record: {
      rollNo: 'M1',
      session: 'Morning',
      date: '2000-01-01',
      timestamp: '00:00:00'
    }
  }, empToken);
  console.log("Test 1 (Valid but forged time):", res.status === 200 ? "PASS" : `FAIL (${res.status} ${res.body.error})`);
  if (res.status === 200) {
    const logsRes = await request('GET', '/api/attendance', null, empToken);
    const log = logsRes.body.logs.find(l => l.rollNo === 'M1');
    console.log("  -> Backend Date:", log.date, "Backend Time:", log.timestamp);
    if (log.date === '2000-01-01') console.log("  -> FAIL (Date forged!)");
  }

  // Test 2: Submitting for Unauthorized Student (M2)
  res = await request('POST', '/api/attendance', {
    record: { rollNo: 'M2', session: 'Morning' }
  }, empToken);
  console.log("Test 2 (Unauthorized Student):", res.status === 400 && res.body.error.includes('Unauthorized') ? "PASS" : `FAIL (${res.status} ${res.body.error})`);

  // Test 3: Submitting for Inactive Student (M3)
  res = await request('POST', '/api/attendance', {
    record: { rollNo: 'M3', session: 'Morning' }
  }, empToken);
  console.log("Test 3 (Inactive Student):", res.status === 400 && res.body.error.includes('inactive') ? "PASS" : `FAIL (${res.status} ${res.body.error})`);

  // Test 4: Submitting Wrong Section
  res = await request('POST', '/api/attendance', {
    record: { rollNo: 'M1', session: 'Morning', section: 'B' } // M1 is Section A
  }, empToken);
  console.log("Test 4 (Wrong Section):", res.status === 400 && res.body.error.includes('section') ? "PASS" : `FAIL (${res.status} ${res.body.error})`);

  // Test 5: Missing Session
  res = await request('POST', '/api/attendance', {
    record: { rollNo: 'M1' }
  }, empToken);
  console.log("Test 5 (Missing Session):", res.status === 400 && res.body.error.includes('Missing') ? "PASS" : `FAIL (${res.status} ${res.body.error})`);

  // Test 6: Bulk Upload (One Valid, One Invalid)
  res = await request('POST', '/api/attendance', {
    logs: [
      { rollNo: 'M1', session: 'Afternoon' },
      { rollNo: 'M2', session: 'Afternoon' } // Unauthorized
    ]
  }, empToken);
  console.log("Test 6 (Bulk Upload with 1 invalid):", res.status === 400 && res.body.error.includes('Unauthorized') ? "PASS" : `FAIL (${res.status} ${res.body.error})`);

  console.log("--- Attendance Tests Complete ---");
}

runTests();
