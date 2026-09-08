/**
 * ==============================================================================
 * SMART ATTENDANCE SYSTEM - DATABASE LAYER (MONGODB ATLAS + LOCAL FAILOVER)
 * ==============================================================================
 * Provides unified persistence with MongoDB Atlas cloud database support
 * and transparent fallback to local JSON storage if offline or unconfigured.
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// No demo data — roster starts empty and is populated only by admin actions

const DEFAULT_ACCOUNTS = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: 'Administrator',
    role: 'admin',
    createdAt: new Date().toISOString()
  },
  {
    username: 'employee',
    password: 'emp123',
    displayName: 'Staff Member',
    role: 'employee',
    createdAt: new Date().toISOString()
  }
];

let client = null;
let db = null;
let isConnected = false;
let activeUri = '';
let activeDbName = 'smart_attendance';
let lastError = null;

// ----------------------------------------------------------------------------
// Local JSON File Helpers (Fallback Storage Engine)
// ----------------------------------------------------------------------------
function readJsonFile(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filename, defaultValue);
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultValue;
  }
}

function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
    return false;
  }
}

// Initialize seed data in local JSON files
readJsonFile('roster.json', []);
readJsonFile('accounts.json', DEFAULT_ACCOUNTS);
readJsonFile('attendance.json', []);
readJsonFile('rules.json', {});

// ----------------------------------------------------------------------------
// MongoDB Atlas Connection & Initialization
// ----------------------------------------------------------------------------
async function connect(uri = process.env.MONGODB_URI, dbName = process.env.DB_NAME || 'smart_attendance') {
  activeUri = uri || '';
  activeDbName = dbName || 'smart_attendance';

  if (!activeUri || !activeUri.trim()) {
    isConnected = false;
    lastError = 'MONGODB_URI not configured in .env';
    console.log('[Storage Engine] Running in Local JSON Mode (./data). To connect MongoDB Atlas, set MONGODB_URI in .env');
    return false;
  }

  try {
    console.log(`[MongoDB Atlas] Attempting connection to cluster...`);
    if (client) {
      try { await client.close(); } catch (e) {}
    }

    client = new MongoClient(activeUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await client.connect();
    db = client.db(activeDbName);
    isConnected = true;
    lastError = null;

    console.log(`[MongoDB Atlas] Successfully connected to database: "${activeDbName}"`);

    // Ensure indexes for performance and uniqueness
    await createIndexes();

    // Auto-migrate / seed initial data into Atlas if newly created
    await seedAtlasIfEmpty();

    return true;
  } catch (err) {
    isConnected = false;
    lastError = err.message;
    console.warn(`[MongoDB Atlas] Connection failed: ${err.message}`);
    console.warn(`[Storage Engine] Fallback to Local JSON Mode (./data) active.`);
    return false;
  }
}

async function createIndexes() {
  if (!isConnected || !db) return;
  try {
    const studentsCol = db.collection('students');
    await studentsCol.createIndex({ rollNo: 1 }, { unique: true });

    const attendanceCol = db.collection('attendance');
    await attendanceCol.createIndex({ id: 1 }, { unique: true });
    await attendanceCol.createIndex({ rollNo: 1, date: 1, session: 1 });

    const accountsCol = db.collection('accounts');
    await accountsCol.createIndex({ username: 1 }, { unique: true });
  } catch (err) {
    console.warn('[MongoDB Atlas] Index creation note:', err.message);
  }
}

async function seedAtlasIfEmpty() {
  if (!isConnected || !db) return;
  try {
    // Students are NOT auto-seeded — only admin-added data is persisted

    // 2. Seed Accounts
    const accountsCol = db.collection('accounts');
    const accountCount = await accountsCol.countDocuments();
    if (accountCount === 0) {
      const localAccounts = readJsonFile('accounts.json', DEFAULT_ACCOUNTS);
      if (localAccounts.length > 0) {
        await accountsCol.insertMany(localAccounts);
        console.log(`[MongoDB Atlas] Seeded ${localAccounts.length} user accounts into "accounts" collection.`);
      }
    }

    // 3. Seed Attendance Logs
    const attendanceCol = db.collection('attendance');
    const attendanceCount = await attendanceCol.countDocuments();
    if (attendanceCount === 0) {
      const localLogs = readJsonFile('attendance.json', []);
      if (localLogs.length > 0) {
        await attendanceCol.insertMany(localLogs);
        console.log(`[MongoDB Atlas] Migrated ${localLogs.length} attendance logs into "attendance" collection.`);
      }
    }

    // 4. Seed Rules
    const rulesCol = db.collection('rules');
    const existingRuleDoc = await rulesCol.findOne({ _id: 'branch_rules' });
    if (!existingRuleDoc) {
      const localRules = readJsonFile('rules.json', {});
      await rulesCol.updateOne(
        { _id: 'branch_rules' },
        { $set: { rules: localRules, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('[MongoDB Atlas] Error during seeding:', err);
  }
}

// ----------------------------------------------------------------------------
// DATA OPERATIONS (Unified Atlas & Local JSON API)
// ----------------------------------------------------------------------------

// --- ROSTER (STUDENTS) ---
async function getStudents() {
  if (isConnected && db) {
    try {
      const docs = await db.collection('students').find({}, { projection: { _id: 0 } }).toArray();
      // Keep local JSON in sync
      writeJsonFile('roster.json', docs);
      return docs;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read error, falling back to local JSON:', err.message);
    }
  }
  return readJsonFile('roster.json', []);
}

async function saveStudents(studentsList) {
  // Always update local JSON
  writeJsonFile('roster.json', studentsList);

  if (isConnected && db) {
    try {
      const col = db.collection('students');
      await col.deleteMany({});
      if (studentsList.length > 0) {
        const cleanDocs = studentsList.map(s => ({
          rollNo: (s.rollNo || '').trim().toUpperCase(),
          name: s.name || '',
          branch: s.branch || '',
          year: s.year || '',
          assignedTo: s.assignedTo || 'all'
        }));
        await col.insertMany(cleanDocs);
      }
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Save students error:', err.message);
    }
  }
  return true;
}

async function importStudents(incoming, assignedTo = 'all') {
  let currentRoster = await getStudents();
  let importedCount = 0;

  incoming.forEach(student => {
    if (!student.rollNo) return;
    const cleanRoll = student.rollNo.trim().toUpperCase();
    const existingIdx = currentRoster.findIndex(s => s.rollNo.toUpperCase() === cleanRoll);

    const studentRecord = {
      rollNo: cleanRoll,
      name: student.name || `Student ${cleanRoll}`,
      branch: student.branch || 'General',
      year: student.year || '2024 Batch (3rd Year)',
      assignedTo: student.assignedTo || assignedTo,
      importedAt: new Date().toISOString()
    };

    if (existingIdx !== -1) {
      currentRoster[existingIdx] = { ...currentRoster[existingIdx], ...studentRecord };
    } else {
      currentRoster.push(studentRecord);
    }
    importedCount++;
  });

  await saveStudents(currentRoster);
  return { importedCount, total: currentRoster.length, students: currentRoster };
}

// --- ATTENDANCE ---
async function getAttendance() {
  if (isConnected && db) {
    try {
      const docs = await db.collection('attendance')
        .find({}, { projection: { _id: 0 } })
        .sort({ date: -1, timestamp: -1 })
        .toArray();
      writeJsonFile('attendance.json', docs);
      return docs;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read attendance error, fallback to local:', err.message);
    }
  }
  return readJsonFile('attendance.json', []);
}

async function saveAttendance(logsList) {
  writeJsonFile('attendance.json', logsList);

  if (isConnected && db) {
    try {
      const col = db.collection('attendance');
      await col.deleteMany({});
      if (logsList.length > 0) {
        await col.insertMany(logsList.map(r => ({ ...r })));
      }
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Replace attendance error:', err.message);
    }
  }
  return true;
}

async function addAttendanceRecord(record) {
  // Read current
  let logs = await getAttendance();
  logs.unshift(record);
  writeJsonFile('attendance.json', logs);

  if (isConnected && db) {
    try {
      await db.collection('attendance').insertOne({ ...record });
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Add record error:', err.message);
    }
  }
  return true;
}

async function deleteAttendanceRecord(recordId) {
  let logs = await getAttendance();

  if (recordId === 'all') {
    logs = [];
    writeJsonFile('attendance.json', []);
    if (isConnected && db) {
      try { await db.collection('attendance').deleteMany({}); } catch (e) {}
    }
    return { count: 0, message: 'All logs cleared' };
  }

  logs = logs.filter(r => r.id !== recordId);
  writeJsonFile('attendance.json', logs);

  if (isConnected && db) {
    try {
      await db.collection('attendance').deleteOne({ id: recordId });
    } catch (e) {}
  }
  return { count: logs.length, message: 'Record deleted' };
}

// --- ACCOUNTS ---
async function getAccounts() {
  if (isConnected && db) {
    try {
      const docs = await db.collection('accounts').find({}, { projection: { _id: 0 } }).toArray();
      writeJsonFile('accounts.json', docs);
      return docs;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read accounts error, fallback:', err.message);
    }
  }
  return readJsonFile('accounts.json', DEFAULT_ACCOUNTS);
}

async function saveAccounts(accountsList) {
  writeJsonFile('accounts.json', accountsList);

  if (isConnected && db) {
    try {
      const col = db.collection('accounts');
      await col.deleteMany({});
      if (accountsList.length > 0) {
        await col.insertMany(accountsList);
      }
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Save accounts error:', err.message);
    }
  }
  return true;
}

// --- BRANCH RULES ---
async function getRules() {
  if (isConnected && db) {
    try {
      const doc = await db.collection('rules').findOne({ _id: 'branch_rules' });
      if (doc && doc.rules) {
        writeJsonFile('rules.json', doc.rules);
        return doc.rules;
      }
    } catch (err) {
      console.warn('[MongoDB Atlas] Read rules error, fallback:', err.message);
    }
  }
  return readJsonFile('rules.json', {});
}

async function saveRules(rulesObj) {
  writeJsonFile('rules.json', rulesObj);

  if (isConnected && db) {
    try {
      await db.collection('rules').updateOne(
        { _id: 'branch_rules' },
        { $set: { rules: rulesObj, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Save rules error:', err.message);
    }
  }
  return true;
}

// ----------------------------------------------------------------------------
// Health, Status & Configuration
// ----------------------------------------------------------------------------
async function getStatus() {
  let counts = { students: 0, attendance: 0, accounts: 0 };
  if (isConnected && db) {
    try {
      counts.students = await db.collection('students').countDocuments();
      counts.attendance = await db.collection('attendance').countDocuments();
      counts.accounts = await db.collection('accounts').countDocuments();
    } catch (e) {}
  } else {
    counts.students = readJsonFile('roster.json', []).length;
    counts.attendance = readJsonFile('attendance.json', []).length;
    counts.accounts = readJsonFile('accounts.json', []).length;
  }

  // Mask URI for security
  let maskedUri = '';
  if (activeUri) {
    maskedUri = activeUri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••••@');
  }

  return {
    connected: isConnected,
    mode: isConnected ? 'mongodb_atlas' : 'local_json',
    dbName: activeDbName,
    uriConfigured: Boolean(activeUri && activeUri.trim()),
    maskedUri: maskedUri,
    lastError: lastError,
    counts: counts
  };
}

async function testConnection(testUri) {
  if (!testUri || !testUri.trim()) {
    return { success: false, error: 'Connection URI string is required.' };
  }

  let testClient = null;
  try {
    testClient = new MongoClient(testUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    await testClient.connect();
    const adminDb = testClient.db().admin();
    const pingResult = await adminDb.ping();
    await testClient.close();
    return { success: true, message: 'Successfully connected and pinged MongoDB Atlas!' };
  } catch (err) {
    if (testClient) {
      try { await testClient.close(); } catch (e) {}
    }
    return { success: false, error: err.message };
  }
}

async function updateUriAndConnect(newUri, dbName = 'smart_attendance') {
  // Update .env file
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('MONGODB_URI=')) {
      envContent = envContent.replace(/MONGODB_URI=.*(\r?\n|$)/, `MONGODB_URI=${newUri}$1`);
    } else {
      envContent += `\nMONGODB_URI=${newUri}\n`;
    }
    if (envContent.includes('DB_NAME=')) {
      envContent = envContent.replace(/DB_NAME=.*(\r?\n|$)/, `DB_NAME=${dbName}$1`);
    } else {
      envContent += `DB_NAME=${dbName}\n`;
    }
  } else {
    envContent = `PORT=3000\nMONGODB_URI=${newUri}\nDB_NAME=${dbName}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');

  // Re-run connect
  process.env.MONGODB_URI = newUri;
  process.env.DB_NAME = dbName;
  return await connect(newUri, dbName);
}

module.exports = {
  connect,
  getStatus,
  testConnection,
  updateUriAndConnect,
  getStudents,
  saveStudents,
  importStudents,
  getAttendance,
  saveAttendance,
  addAttendanceRecord,
  deleteAttendanceRecord,
  getAccounts,
  saveAccounts,
  getRules,
  saveRules
};
