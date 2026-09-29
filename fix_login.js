const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const startMarker = "      const bcrypt = require('bcryptjs');";
const endMarker = "      const jwt = require('jsonwebtoken');";

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx);
    
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
      }

`;

    content = before + fixedLogin + after;
    fs.writeFileSync('server.js', content);
    console.log('Successfully replaced login block.');
} else {
    console.log('Could not find markers');
}
