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
  console.log("--- Starting Tests ---");

  // 1. Missing Token
  let res = await request('GET', '/api/roster');
  console.log("Missing Token (/api/roster):", res.status === 401 ? "PASS" : "FAIL (" + res.status + ")");

  // 2. Invalid Token
  res = await request('GET', '/api/roster', null, 'invalid_token_string');
  console.log("Invalid Token (/api/roster):", res.status === 401 ? "PASS" : "FAIL (" + res.status + ")");

  // 3. Admin Login
  res = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
  console.log("Admin Login:", res.status === 200 && res.body.token ? "PASS" : "FAIL");
  const adminToken = res.body.token;

  // 4. Employee Login
  res = await request('POST', '/api/login', { username: 'employee', password: 'emp123' });
  console.log("Employee Login:", res.status === 200 && res.body.token ? "PASS" : "FAIL");
  const empToken = res.body.token;

  // 5. Tampered Token (change a character in signature)
  const tamperedToken = empToken.slice(0, -5) + 'xxxxx';
  res = await request('GET', '/api/roster', null, tamperedToken);
  console.log("Tampered Token (/api/roster):", res.status === 401 ? "PASS" : "FAIL (" + res.status + ")");

  // 6. Employee attempting admin API (/api/accounts)
  res = await request('GET', '/api/accounts', null, empToken);
  console.log("Employee attempting Admin API (/api/accounts):", res.status === 403 ? "PASS" : "FAIL (" + res.status + ")");

  // 7. Data Isolation (Employee getting roster)
  // First, add some students as admin
  await request('POST', '/api/roster', {
    students: [
      { rollNo: 'A1', name: 'Alice', assignedTo: 'employee' },
      { rollNo: 'A2', name: 'Bob', assignedTo: 'admin' }, // admin-only
      { rollNo: 'A3', name: 'Charlie', assignedTo: 'all' }
    ]
  }, adminToken);

  res = await request('GET', '/api/roster', null, empToken);
  const employeeSees = res.body.students.map(s => s.name);
  const correctIsolation = employeeSees.includes('Alice') && !employeeSees.includes('Bob') && employeeSees.includes('Charlie');
  console.log("Employee Data Isolation (Roster):", correctIsolation ? "PASS" : "FAIL", "(Sees: " + employeeSees.join(', ') + ")");

  console.log("--- Tests Complete ---");
}

runTests();
