const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// 1. Fix the broken login block
const brokenRegex = /const bcrypt = require\('bcryptjs'\);\s*const account = accounts\.find\(a => a\.username\.toLowerCase\(\) === \(body\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\)\);\s*let isValid = false;\s*if \(account\) \{\s*if \(account\.password && \(account\.password\.startsWith\('\$2a\s*return sendJson\(res, 401, \{ success: false, error: 'Invalid username or password' \}\);\s*\}/;

const fixedLogin = `      const bcrypt = require('bcryptjs');
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
      }`;

content = content.replace(brokenRegex, fixedLogin);


// 2. Fix duplication (remove everything after the first `});\n\n` that is at the end of the file)
// Let's find the closing of the file:
const eofMarker = `}).catch(err => {
  console.error('Server startup error:', err);
  server.listen(PORT, () => {
    console.log(\`Server listening in fallback mode at http://localhost:\${PORT}\`);
  });
});`;

const parts = content.split(eofMarker);
if (parts.length > 1) {
    content = parts[0] + eofMarker + '\n';
}

fs.writeFileSync('server.js', content);
console.log('Fixed server.js corruption and syntax error.');
