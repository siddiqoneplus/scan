const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

const brokenBlock = `      // DELETE: Clear ALL students from DB + local JSON
      
      
      }`;

const fixedBlock = `      // DELETE: Clear ALL students from DB + local JSON`;

server = server.replace(brokenBlock, fixedBlock);

fs.writeFileSync('server.js', server);
console.log('Fixed syntax error in server.js');
