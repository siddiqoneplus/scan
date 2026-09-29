const fs = require('fs');
let dbjs = fs.readFileSync('db.js', 'utf8');

const startMarker = "async function migratePasswords() {";
const endMarker = "  if (!isConnected || !db) return;";

const startIdx = dbjs.indexOf(startMarker);
const endIdx = dbjs.indexOf(endMarker, startIdx + startMarker.length); // this is inside seedAtlasIfEmpty which got pushed down!

if (startIdx !== -1 && endIdx !== -1) {
    const before = dbjs.substring(0, startIdx);
    const after = dbjs.substring(endIdx); // starts with `  if (!isConnected || !db) return;` of seedAtlasIfEmpty
    
    const fixedBlock = `async function migratePasswords() {
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
           // We'll skip local json update to keep it simple, Atlas is the source of truth
           
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

async function seedAtlasIfEmpty() {
`;

    dbjs = before + fixedBlock + after;
    fs.writeFileSync('db.js', dbjs);
    console.log('Successfully fixed db.js.');
} else {
    console.log('Could not find markers');
}
