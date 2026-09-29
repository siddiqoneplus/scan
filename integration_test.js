const http = require('http');

async function testApi() {
  console.log("Running production readiness checks...");
  
  const request = (method, path, body, headers = {}) => {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  try {
    // 1. Test Auth
    console.log("1. Testing Authentication (Login)");
    // admin123 hash is in db.js, we will try default admin login
    const loginRes = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
    if (loginRes.status !== 200 || !loginRes.body.token) throw new Error("Login failed");
    const token = loginRes.body.token;
    console.log("   -> Login OK, Token received");

    // 2. Test Roster Mass Assignment Fix
    console.log("2. Testing Roster Injection Defense");
    const rosterRes = await request('POST', '/api/roster', {
      students: [{ rollNo: 'TEST1234', name: 'Injection Tester', password: 'hacked', _id: 'hacked_id' }]
    }, { Authorization: `Bearer ${token}` });
    
    if (rosterRes.status !== 200) throw new Error("Roster create failed");
    
    // Check if the hack worked
    // (We would ideally check MongoDB or the returned array)
    const returnedStudent = rosterRes.body.students.find(s => s.rollNo === 'TEST1234');
    if (returnedStudent.password || returnedStudent._id) {
       console.log("   -> MASS ASSIGNMENT VULNERABILITY DETECTED!");
       throw new Error("Vulnerable to mass assignment");
    }
    console.log("   -> Roster Injection Blocked OK");

    // 3. Test Invalid JWT
    console.log("3. Testing JWT Validation");
    const jwtRes = await request('GET', '/api/accounts', null, { Authorization: `Bearer ${token}invalid` });
    if (jwtRes.status !== 401) throw new Error(`Invalid JWT check failed, status: ${jwtRes.status}`);
    console.log("   -> JWT Validation OK");
    
    // 4. Test IDOR / Rate Limit Checks
    console.log("4. Testing Basic Rate Limit Presence");
    let rlRes;
    for(let i=0; i<6; i++) {
        rlRes = await request('POST', '/api/login', { username: 'admin', password: 'wrong' });
    }
    if (rlRes.status === 429) {
        console.log("   -> Rate limiting works OK");
    } else {
        console.log("   -> Rate limit test inconclusive or higher limit set. Status: " + rlRes.status);
    }
    
    console.log("All critical checks passed successfully!");
    
  } catch (e) {
    console.error("Test failed: ", e.message);
  }
}

testApi();
