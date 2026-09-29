const fs = require('fs');

// --- PATCH DB.JS ---
let dbjs = fs.readFileSync('db.js', 'utf8');

const migrationHook = `
    // Auto-migrate / seed initial data into Atlas if newly created
    await seedAtlasIfEmpty();
    
    // Migrate legacy plaintext passwords to bcrypt safely
    await migratePasswords();
`;

const migrationFunction = `
async function migratePasswords() {
  if (!isConnected || !db) return;
  try {
    const bcrypt = require('bcryptjs');
    const accountsCol = db.collection('accounts');
    const accounts = await accountsCol.find({}).toArray();
    let migratedCount = 0;
    
    for (const acc of accounts) {
       if (acc.password && !acc.password.startsWith('$2a$') && !acc.password.startsWith('$2b$')) {
           const hashed = await bcrypt.hash(acc.password, 10);
           await accountsCol.updateOne({ _id: acc._id }, { $set: { password: hashed } });
           
           // Also update local JSON if running in hybrid mode
           const local = readJsonFile('accounts.json', []);
           const lAcc = local.find(a => a.username === acc.username);
           if (lAcc) {
               lAcc.password = hashed;
               writeJsonFile('accounts.json', local);
           }
           
           migratedCount++;
       }
    }
    
    if (migratedCount > 0) {
       console.log(\`[Storage Engine] Migrated \${migratedCount} legacy plaintext passwords to secure bcrypt hashes.\`);
    }
  } catch (err) {
    console.warn('[Storage Engine] Failed to migrate passwords:', err.message);
  }
}
`;

if (!dbjs.includes('await migratePasswords();')) {
    dbjs = dbjs.replace('// Auto-migrate / seed initial data into Atlas if newly created\n    await seedAtlasIfEmpty();', migrationHook);
    dbjs = dbjs.replace('async function seedAtlasIfEmpty() {', migrationFunction + '\nasync function seedAtlasIfEmpty() {');
    fs.writeFileSync('db.js', dbjs);
}


// --- PATCH SERVER.JS ---
let server = fs.readFileSync('server.js', 'utf8');

// 1. Patch Login Endpoint
const loginBlockReplacement = `      const bcrypt = require('bcryptjs');
      const account = accounts.find(a => a.username.toLowerCase() === (body.username || '').trim().toLowerCase());
      let isValid = false;
      
      if (account) {
         if (account.password && (account.password.startsWith('$2a$') || account.password.startsWith('$2b$'))) {
             isValid = await bcrypt.compare(body.password || '', account.password);
         } else if (account.password) {
             isValid = (account.password === body.password);
         }
      }
      
      if (!isValid) {`;

server = server.replace(/const account = accounts\.find\(a => a\.username\.toLowerCase\(\) === \(body\.username \|\| ''\)\.trim\(\)\.toLowerCase\(\) && a\.password === body\.password\);\s*if \(!account\) \{/, loginBlockReplacement);

// 2. Patch POST /api/accounts
const accountsPostRegex = /const mergedAccounts = incomingAccounts\.map\(acc => \{[\s\S]*?const existingPass = existingMap\.get\(acc\.username\.toLowerCase\(\)\);[\s\S]*?return \{ \.\.\.acc, password: acc\.password \|\| existingPass \};[\s\S]*?\}\);/;

const accountsPostReplacement = `const bcrypt = require('bcryptjs');
          const mergedAccounts = await Promise.all(incomingAccounts.map(async acc => {
             const existingPass = existingMap.get(acc.username.toLowerCase());
             
             let finalPassword = existingPass;
             if (acc.password && acc.password.trim() !== '') {
                 if (acc.password.length < 6) {
                    throw new Error('Password must be at least 6 characters long.');
                 }
                 finalPassword = await bcrypt.hash(acc.password, 10);
             } else if (!existingPass) {
                 throw new Error(\`Password is required for new account: \${acc.username}\`);
             }
             
             return { ...acc, password: finalPassword };
          }));`;

server = server.replace(accountsPostRegex, accountsPostReplacement);

// We need to wrap the whole POST accounts block in try/catch if it isn't already to catch the Error we throw
if (server.includes(accountsPostReplacement) && !server.includes('try { // accounts-post')) {
    const postAccountsBlock = /if \(req\.method === 'POST'\) \{[\s\S]*?if \(!requireAdmin\(\)\) return;[\s\S]*?const body = await parseBody\(req\);[\s\S]*?const incomingAccounts = Array\.isArray\(body\) \? body : \(body\.accounts \|\| \[\]\);[\s\S]*?if \(incomingAccounts\.length > 0\) \{[\s\S]*?const existingAccounts = await db\.getAccounts\(\);[\s\S]*?const existingMap = new Map\(existingAccounts\.map\(a => \[a\.username\.toLowerCase\(\), a\.password\]\)\);[\s\S]*?const bcrypt = require\('bcryptjs'\);[\s\S]*?await Promise\.all\([\s\S]*?\}\);[\s\S]*?await db\.saveAccounts\(mergedAccounts\);[\s\S]*?\}[\s\S]*?return sendJson\(res, 200, \{ success: true, count: incomingAccounts\.length \}\);[\s\S]*?\}/;
    
    server = server.replace(postAccountsBlock, (match) => {
        return match.replace("const incomingAccounts", "try { // accounts-post\n        const incomingAccounts")
                    .replace("return sendJson(res, 200, { success: true, count: incomingAccounts.length });", "return sendJson(res, 200, { success: true, count: incomingAccounts.length });\n        } catch(e) { return handleApiError(res, e); }");
    });
}

fs.writeFileSync('server.js', server);
console.log('Patched server.js and db.js for secure password hashing and migration.');
