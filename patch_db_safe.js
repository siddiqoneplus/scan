const fs = require('fs');
let dbjs = fs.readFileSync('db.js', 'utf8');

const hookTarget = "await seedAtlasIfEmpty();";
const hookInjection = `await seedAtlasIfEmpty();
    
    // Migrate legacy plaintext passwords to bcrypt safely
    await migratePasswords();`;

const functionTarget = "async function seedAtlasIfEmpty() {";
const functionInjection = `async function migratePasswords() {
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

async function seedAtlasIfEmpty() {`;

// Safely split and join to avoid regex evaluation of $
if (!dbjs.includes('await migratePasswords();')) {
    let parts1 = dbjs.split(hookTarget);
    if (parts1.length > 1) {
       dbjs = parts1[0] + hookInjection + parts1.slice(1).join(hookTarget);
    }
    
    let parts2 = dbjs.split(functionTarget);
    if (parts2.length > 1) {
       dbjs = parts2[0] + functionInjection + parts2.slice(1).join(functionTarget);
    }
    
    fs.writeFileSync('db.js', dbjs);
    console.log('Safely patched db.js');
} else {
    console.log('db.js already patched');
}
