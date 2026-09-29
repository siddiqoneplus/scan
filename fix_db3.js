const fs = require('fs');
let dbjs = fs.readFileSync('db.js', 'utf8');

const startMarker = "async function migratePasswords() {";
const endMarker = "    // Students are NOT auto-seeded";

const startIdx = dbjs.indexOf(startMarker);
const endIdx = dbjs.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
    const before = dbjs.substring(0, startIdx);
    const after = dbjs.substring(endIdx);
    
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
  if (!isConnected || !db) return;
  try {
`;

    dbjs = before + fixedBlock + after;
    fs.writeFileSync('db.js', dbjs);
    console.log('Successfully fixed db.js (round 3).');
} else {
    console.log('Could not find markers');
}
