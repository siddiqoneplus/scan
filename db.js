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
readJsonFile('events.json', []);
readJsonFile('event_registrations.json', []);

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
    const attendanceCol = db.collection('attendance');
    const accountsCol = db.collection('accounts');
    const eventsCol = db.collection('events');
    const eventRegsCol = db.collection('event_registrations');

    console.log('[Storage Engine] Starting Database Migration & Indexing...');

    // --- 1. HANDLE EXISTING DUPLICATES BEFORE UNIQUE INDEXES ---

    // Deduplicate Students (by rollNo)
    const duplicateStudents = await studentsCol.aggregate([
      { $group: { _id: { rollNo: "$rollNo" }, count: { $sum: 1 }, docs: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    for (const dup of duplicateStudents) {
       // Keep the first one, delete the rest
       const idsToDelete = dup.docs.slice(1);
       await studentsCol.deleteMany({ _id: { $in: idsToDelete } });
       console.log(`[Storage Engine] Removed ${idsToDelete.length} duplicate student records for RollNo: ${dup._id.rollNo}`);
    }

    // Deduplicate Attendance (by rollNo, date, session, eventId)
    const duplicateAttendance = await attendanceCol.aggregate([
      { 
         $group: { 
           _id: { rollNo: "$rollNo", date: "$date", session: "$session", eventId: "$eventId" }, 
           count: { $sum: 1 }, 
           docs: { $push: "$_id" } 
         } 
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    for (const dup of duplicateAttendance) {
       const idsToDelete = dup.docs.slice(1);
       await attendanceCol.deleteMany({ _id: { $in: idsToDelete } });
       console.log(`[Storage Engine] Removed ${idsToDelete.length} duplicate attendance records for ${dup._id.rollNo} on ${dup._id.date}`);
    }

    // --- 2. CREATE UNIQUE INDEXES ---
    await studentsCol.createIndex({ rollNo: 1 }, { unique: true });
    await attendanceCol.createIndex({ id: 1 }, { unique: true });
    await attendanceCol.createIndex({ rollNo: 1, date: 1, session: 1, eventId: 1 }, { unique: true });
    await accountsCol.createIndex({ username: 1 }, { unique: true });
    await eventsCol.createIndex({ id: 1 }, { unique: true });
    await eventRegsCol.createIndex({ eventId: 1, rollNo: 1 }, { unique: true });

    // --- 3. CREATE PERFORMANCE INDEXES FOR QUERY PATTERNS ---
    // The application frequently sorts attendance by date and timestamp descending
    await attendanceCol.createIndex({ date: -1, timestamp: -1 });
    // The application frequently filters students by active status and branch/year/section
    await studentsCol.createIndex({ status: 1, branch: 1, year: 1, section: 1 });
    // The application frequently filters attendance by date (for reports and dashboards)
    await attendanceCol.createIndex({ date: 1 });
    
    console.log('[Storage Engine] Database Migration & Indexing Complete!');
  } catch (err) {
    console.warn('[MongoDB Atlas] Index creation error:', err.message);
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

    // 3. Attendance logs are operational data and are NEVER auto-seeded

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
  // Deduplicate by rollNo to guarantee integrity and avoid MongoDB E11000 duplicate key errors
  const map = new Map();
  if (Array.isArray(studentsList)) {
    studentsList.forEach(s => {
      if (s && s.rollNo) {
        const clean = (s.rollNo || '').trim().toUpperCase();
        map.set(clean, {
          rollNo: clean,
          name: s.name || `Student ${clean}`,
          branch: s.branch || '',
          year: s.year || '',
          section: s.section || '',
          assignedTo: s.assignedTo || 'all',
          status: s.status || 'active'
        });
      }
    });
  }
  const cleanDocs = Array.from(map.values());

  // Always update local JSON
  writeJsonFile('roster.json', cleanDocs);

  if (isConnected && db) {
    try {
      const col = db.collection('students');
      await col.deleteMany({});
      if (cleanDocs.length > 0) {
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
  const _rulesContext = await getClassificationRules();
  let currentRoster = await getStudents();
  
  let totalRows = incoming.length;
  let successfullyImported = 0;
  let duplicateCount = 0;
  let invalidRowsCount = 0;
  let skippedRowsCount = 0;
  let errors = [];

  const validStudentsToImport = [];
  const incomingRollsSeen = new Set();
  const existingRolls = new Set(currentRoster.map(s => s.rollNo.toUpperCase()));

  incoming.forEach((student, index) => {
    // 1. Basic presence check
    if (!student || !student.rollNo || typeof student.rollNo !== 'string') {
      invalidRowsCount++;
      errors.push(`Row ${index + 1}: Missing or invalid roll number.`);
      return;
    }

    const cleanRoll = student.rollNo.trim().toUpperCase();

    // 2. Validate roll number format (alphanumeric and dashes)
    if (!/^[A-Z0-9-]+$/.test(cleanRoll)) {
      invalidRowsCount++;
      errors.push(`Row ${index + 1}: Invalid roll number format '${cleanRoll}'. Only alphanumeric characters and dashes allowed.`);
      return;
    }

    // 3. Duplicate within uploaded file
    if (incomingRollsSeen.has(cleanRoll)) {
      duplicateCount++;
      skippedRowsCount++;
      errors.push(`Row ${index + 1}: Roll number '${cleanRoll}' is a duplicate within the upload file.`);
      return;
    }
    incomingRollsSeen.add(cleanRoll);

    // 4. Duplicate in MongoDB
    if (existingRolls.has(cleanRoll)) {
      duplicateCount++;
      skippedRowsCount++;
      errors.push(`Row ${index + 1}: Roll number '${cleanRoll}' already exists in the database.`);
      return;
    }

    // 5. Trim and normalize fields
    const name = typeof student.name === 'string' ? student.name.trim() : `Student ${cleanRoll}`;
    let branch = typeof student.branch === 'string' ? student.branch.trim() : '';
    let year = typeof student.year === 'string' ? student.year.trim() : '';
    let section = typeof student.section === 'string' ? student.section.trim() : '';

    const classification = applyClassificationRules(cleanRoll, _rulesContext);
    if (classification) {
       branch = classification.branch || branch;
       year = classification.academicYear || year;
       section = classification.section || section;
    }

    if (!branch) branch = 'General';
    if (!year) year = '2024 Batch (3rd Year)';
    
    // Basic length validation
    if (name.length === 0 || branch.length === 0 || year.length === 0) {
      invalidRowsCount++;
      errors.push(`Row ${index + 1}: Name, Branch, or Year cannot be empty after trimming.`);
      return;
    }

    const studentRecord = {
      rollNo: cleanRoll,
      name,
      branch,
      year,
      section,
      assignedTo: student.assignedTo || assignedTo,
      status: student.status || 'active',
      importedAt: new Date().toISOString()
    };

    validStudentsToImport.push(studentRecord);
  });

  // Batch insert valid students
  if (validStudentsToImport.length > 0) {
    // We add them to currentRoster and then use saveStudents, which handles MongoDB upserts and JSON files
    currentRoster = [...currentRoster, ...validStudentsToImport];
    const success = await saveStudents(currentRoster);
    if (!success) {
       throw new Error('Database write failed during bulk import. No records were saved.');
    }
    successfullyImported = validStudentsToImport.length;
  }

  return { 
    total: totalRows,
    importedCount: successfullyImported,
    duplicates: duplicateCount,
    invalidRows: invalidRowsCount,
    skippedRows: skippedRowsCount,
    errors,
    students: currentRoster 
  };
}

// --- ATTENDANCE ---
async function getAttendance() {
  const localDocs = readJsonFile('attendance.json', []);
  if (isConnected && db) {
    try {
      const docs = await db.collection('attendance')
        .find({}, { projection: { _id: 0 } })
        .sort({ date: -1, timestamp: -1 })
        .toArray();

      // Merge Atlas documents with local JSON so nothing is ever dropped
      const map = new Map();
      localDocs.forEach(r => { if (r && (r.id || r.rollNo)) map.set(r.id || `${r.rollNo}_${r.date}_${r.session}`, r); });
      docs.forEach(r => { if (r && (r.id || r.rollNo)) map.set(r.id || `${r.rollNo}_${r.date}_${r.session}`, r); });

      const merged = Array.from(map.values()).sort((a, b) => {
        const timeA = `${a.date || ''} ${a.timestamp || ''}`;
        const timeB = `${b.date || ''} ${b.timestamp || ''}`;
        return timeB.localeCompare(timeA);
      });

      writeJsonFile('attendance.json', merged);
      return merged;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read attendance error, fallback to local:', err.message);
    }
  }
  return localDocs;
}

async function saveAttendance(logsList) {
  if (!Array.isArray(logsList)) return false;

  // Smart merge with existing local JSON so previously saved records are never lost
  const localDocs = readJsonFile('attendance.json', []);
  const map = new Map();
  localDocs.forEach(r => { if (r && (r.id || r.rollNo)) map.set(r.id || `${r.rollNo}_${r.date}_${r.session}`, r); });
  logsList.forEach(r => { if (r && (r.id || r.rollNo)) map.set(r.id || `${r.rollNo}_${r.date}_${r.session}`, r); });

  const merged = Array.from(map.values()).sort((a, b) => {
    const timeA = `${a.date || ''} ${a.timestamp || ''}`;
    const timeB = `${b.date || ''} ${b.timestamp || ''}`;
    return timeB.localeCompare(timeA);
  });

  writeJsonFile('attendance.json', merged);

  if (isConnected && db) {
    try {
      const col = db.collection('attendance');
      if (logsList.length > 0) {
        const ops = logsList.map(r => {
          const doc = { ...r };
          delete doc._id;
          return {
            updateOne: {
              filter: { id: r.id },
              update: { $set: doc },
              upsert: true
            }
          };
        });
        await col.bulkWrite(ops, { ordered: false });
      }
      return true;
    } catch (err) {
      console.warn('[MongoDB Atlas] Save attendance bulk upsert note:', err.message);
    }
  }
  return true;
}

async function addAttendanceRecord(record) {
  if (!record) return false;
  if (!record.id) {
    record.id = 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  }

  // If connected to Atlas, insert atomically first to catch duplicates
  if (isConnected && db) {
    try {
      const doc = { ...record };
      delete doc._id;
      await db.collection('attendance').insertOne(doc);
    } catch (err) {
      if (err.code === 11000) {
         throw new Error('DUPLICATE_ATTENDANCE');
      }
      console.warn('[MongoDB Atlas] Add attendance record error:', err.message);
    }
  }

  // Update local JSON with deduplication only after MongoDB succeeds (or if offline)
  let currentLogs = readJsonFile('attendance.json', []);
  const isDuplicate = currentLogs.some(r => r.rollNo === record.rollNo && r.date === record.date && r.session === record.session && r.eventId === record.eventId);
  if (isDuplicate) {
    if (isConnected && db) {
       // Already caught by E11000 if connected, but just in case
       throw new Error('DUPLICATE_ATTENDANCE');
    }
    throw new Error('DUPLICATE_ATTENDANCE');
  }
  currentLogs.unshift(record);
  writeJsonFile('attendance.json', currentLogs);
  return true;
}


async function updateAttendanceRecord(recordId, updates) {
  let logs = readJsonFile('attendance.json', []);
  const index = logs.findIndex(r => r.id === recordId);
  if (index === -1) throw new Error('Record not found');
  
  logs[index] = { ...logs[index], ...updates };
  writeJsonFile('attendance.json', logs);
  
  if (isConnected && db) {
    try {
      await db.collection('attendance').updateOne({ id: recordId }, { $set: updates });
    } catch (e) {
      console.warn('[MongoDB Atlas] Update attendance error:', e.message);
    }
  }
  return logs[index];
}

async function deleteAttendanceRecord(recordId) {
  if (recordId === 'all' || !recordId) {
    writeJsonFile('attendance.json', []);
    if (isConnected && db) {
      try {
        await db.collection('attendance').deleteMany({});
      } catch (e) {
        console.warn('[MongoDB Atlas] Clear attendance error:', e.message);
      }
    }
    return { count: 0, message: 'All logs cleared' };
  }

  let logs = await getAttendance();
  logs = logs.filter(r => r.id !== recordId);
  writeJsonFile('attendance.json', logs);

  if (isConnected && db) {
    try {
      await db.collection('attendance').deleteOne({ id: recordId });
    } catch (e) {}
  }
  return { count: logs.length, message: 'Record deleted' };
}

async function clearAllSystemData() {
  // Wipe roster and attendance locally
  writeJsonFile('roster.json', []);
  writeJsonFile('attendance.json', []);

  // Wipe roster and attendance in MongoDB Atlas permanently
  if (isConnected && db) {
    try {
      await db.collection('students').deleteMany({});
      await db.collection('attendance').deleteMany({});
      console.log('[MongoDB Atlas] All students and attendance permanently cleared.');
    } catch (err) {
      console.warn('[MongoDB Atlas] Clear all data note:', err.message);
    }
  }
  return { count: 0, message: 'All system data permanently cleared' };
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

// --- EVENTS ---
async function getEvents() {
  if (isConnected && db) {
    try {
      const docs = await db.collection('events').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
      writeJsonFile('events.json', docs);
      return docs;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read events error, fallback:', err.message);
    }
  }
  return readJsonFile('events.json', []);
}

async function createEvent(eventData) {
  const event = {
    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    name: eventData.name || 'Untitled Event',
    date: eventData.date || new Date().toISOString().split('T')[0],
    description: eventData.description || '',
    status: 'active',
    createdBy: eventData.createdBy || 'admin',
    createdAt: new Date().toISOString()
  };

  const events = readJsonFile('events.json', []);
  events.unshift(event);
  writeJsonFile('events.json', events);

  if (isConnected && db) {
    try {
      await db.collection('events').insertOne({ ...event });
    } catch (err) {
      console.warn('[MongoDB Atlas] Create event error:', err.message);
    }
  }
  return event;
}

async function updateEvent(eventId, updates) {
  const events = readJsonFile('events.json', []);
  const idx = events.findIndex(e => e.id === eventId);
  if (idx === -1) return null;

  events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonFile('events.json', events);

  if (isConnected && db) {
    try {
      const updateDoc = { ...updates, updatedAt: new Date().toISOString() };
      delete updateDoc.id;
      delete updateDoc._id;
      await db.collection('events').updateOne({ id: eventId }, { $set: updateDoc });
    } catch (err) {
      console.warn('[MongoDB Atlas] Update event error:', err.message);
    }
  }
  return events[idx];
}

async function deleteEvent(eventId) {
  let events = readJsonFile('events.json', []);
  events = events.filter(e => e.id !== eventId);
  writeJsonFile('events.json', events);

  // Also remove all registrations and attendance for this event
  let regs = readJsonFile('event_registrations.json', []);
  regs = regs.filter(r => r.eventId !== eventId);
  writeJsonFile('event_registrations.json', regs);

  let attendance = readJsonFile('attendance.json', []);
  const eventAttendance = attendance.filter(a => a.eventId === eventId);
  attendance = attendance.filter(a => a.eventId !== eventId);
  writeJsonFile('attendance.json', attendance);

  if (isConnected && db) {
    try {
      await db.collection('events').deleteOne({ id: eventId });
      await db.collection('event_registrations').deleteMany({ eventId });
      await db.collection('attendance').deleteMany({ eventId });
    } catch (err) {
      console.warn('[MongoDB Atlas] Delete event error:', err.message);
    }
  }
  return { deletedAttendance: eventAttendance.length };
}

// --- EVENT REGISTRATIONS ---
async function getEventRegistrations(eventId) {
  if (isConnected && db) {
    try {
      const docs = await db.collection('event_registrations').find({ eventId }, { projection: { _id: 0 } }).toArray();
      // Merge to local
      const allRegs = readJsonFile('event_registrations.json', []);
      const otherRegs = allRegs.filter(r => r.eventId !== eventId);
      writeJsonFile('event_registrations.json', [...otherRegs, ...docs]);
      return docs.map(d => d.rollNo);
    } catch (err) {
      console.warn('[MongoDB Atlas] Read event registrations error:', err.message);
    }
  }
  const regs = readJsonFile('event_registrations.json', []);
  return regs.filter(r => r.eventId === eventId).map(r => r.rollNo);
}

async function registerStudentsToEvent(eventId, rollNumbers) {
  if (!Array.isArray(rollNumbers) || rollNumbers.length === 0) return { added: 0 };

  const regs = readJsonFile('event_registrations.json', []);
  let added = 0;

  rollNumbers.forEach(rollNo => {
    const clean = rollNo.trim().toUpperCase();
    const exists = regs.some(r => r.eventId === eventId && r.rollNo === clean);
    if (!exists) {
      regs.push({ eventId, rollNo: clean, registeredAt: new Date().toISOString() });
      added++;
    }
  });

  writeJsonFile('event_registrations.json', regs);

  if (isConnected && db) {
    try {
      const docs = rollNumbers.map(rollNo => ({
        eventId,
        rollNo: rollNo.trim().toUpperCase(),
        registeredAt: new Date().toISOString()
      }));
      await db.collection('event_registrations').bulkWrite(
        docs.map(d => ({
          updateOne: {
            filter: { eventId: d.eventId, rollNo: d.rollNo },
            update: { $set: d },
            upsert: true
          }
        })),
        { ordered: false }
      );
    } catch (err) {
      console.warn('[MongoDB Atlas] Register students to event error:', err.message);
    }
  }
  return { added, total: regs.filter(r => r.eventId === eventId).length };
}

async function unregisterStudentFromEvent(eventId, rollNo) {
  const clean = rollNo.trim().toUpperCase();
  let regs = readJsonFile('event_registrations.json', []);
  regs = regs.filter(r => !(r.eventId === eventId && r.rollNo === clean));
  writeJsonFile('event_registrations.json', regs);

  if (isConnected && db) {
    try {
      await db.collection('event_registrations').deleteOne({ eventId, rollNo: clean });
    } catch (err) {
      console.warn('[MongoDB Atlas] Unregister student error:', err.message);
    }
  }
  return { remaining: regs.filter(r => r.eventId === eventId).length };
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

  return {
    connected: isConnected,
    mode: isConnected ? 'mongodb_atlas' : 'local_json',
    dbName: activeDbName,
    uriConfigured: Boolean(activeUri && activeUri.trim()),
    counts: counts
  };
}



// --- CLASSIFICATION RULES ---
async function getClassificationRules() {
  const localRules = readJsonFile('classification_rules.json', []);
  if (isConnected && db) {
    try {
      const atlasRules = await db.collection('classification_rules').find({}, { projection: { _id: 0 } }).toArray();
      const map = new Map();
      localRules.forEach(r => map.set(r.id, r));
      atlasRules.forEach(r => map.set(r.id, r));
      const merged = Array.from(map.values());
      writeJsonFile('classification_rules.json', merged);
      return merged;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read rules error:', err.message);
    }
  }
  return localRules;
}

function checkRuleOverlap(newRule, existingRules) {
  for (const rule of existingRules) {
    if (rule.id === newRule.id) continue;
    
    // Check if prefixes match (case insensitive)
    if (rule.prefix.toUpperCase() === newRule.prefix.toUpperCase()) {
       // Check range overlap
       const maxStart = Math.max(rule.startRange, newRule.startRange);
       const minEnd = Math.min(rule.endRange, newRule.endRange);
       if (maxStart <= minEnd) {
         throw new Error(`Rule overlaps with existing rule '${rule.name || rule.id}' for prefix ${rule.prefix} (range ${maxStart}-${minEnd})`);
       }
    }
  }
}

async function saveClassificationRule(rule) {
  let rules = await getClassificationRules();
  
  if (!rule.id) {
    rule.id = 'rule-' + Date.now();
  }
  
  // Normalize types
  rule.startRange = parseInt(rule.startRange, 10) || 0;
  rule.endRange = parseInt(rule.endRange, 10) || 999999;
  rule.prefix = (rule.prefix || '').trim().toUpperCase();
  rule.enabled = rule.enabled !== false;
  
  checkRuleOverlap(rule, rules);
  
  const existingIdx = rules.findIndex(r => r.id === rule.id);
  if (existingIdx !== -1) {
    rules[existingIdx] = { ...rules[existingIdx], ...rule };
  } else {
    rules.push(rule);
  }
  
  writeJsonFile('classification_rules.json', rules);
  
  if (isConnected && db) {
    try {
      await db.collection('classification_rules').updateOne(
        { id: rule.id },
        { $set: rule },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[MongoDB Atlas] Save rule error:', e.message);
    }
  }
  
  return rule;
}

async function deleteClassificationRule(id) {
  let rules = await getClassificationRules();
  rules = rules.filter(r => r.id !== id);
  writeJsonFile('classification_rules.json', rules);
  
  if (isConnected && db) {
    try {
       await db.collection('classification_rules').deleteOne({ id });
    } catch (e) { }
  }
  return { success: true };
}

function applyClassificationRules(rollNo, rules) {
  if (!rollNo) return null;
  const cleanRoll = rollNo.trim().toUpperCase();
  
  // Find a matching rule
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    if (cleanRoll.startsWith(rule.prefix)) {
       const suffix = cleanRoll.substring(rule.prefix.length);
       // Parse suffix as integer
       const num = parseInt(suffix, 10);
       
       if (!isNaN(num) && num >= rule.startRange && num <= rule.endRange) {
         return {
           branch: rule.branch,
           academicYear: rule.academicYear,
           section: rule.section
         };
       }
    }
  }
  return null;
}


// --- ATTENDANCE SESSIONS ---
async function getSessions() {
  const localSessions = readJsonFile('attendance_sessions.json', []);
  if (isConnected && db) {
    try {
      const atlasSessions = await db.collection('attendance_sessions').find({}, { projection: { _id: 0 } }).toArray();
      const map = new Map();
      localSessions.forEach(s => map.set(s.sessionId, s));
      atlasSessions.forEach(s => map.set(s.sessionId, s));
      const merged = Array.from(map.values());
      writeJsonFile('attendance_sessions.json', merged);
      return merged;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read sessions error:', err.message);
    }
  }
  return localSessions;
}

async function saveSession(session) {
  let sessions = await getSessions();
  
  if (!session.sessionId) {
    session.sessionId = 'session-' + Date.now();
  }
  
  const existingIdx = sessions.findIndex(s => s.sessionId === session.sessionId);
  if (existingIdx !== -1) {
    sessions[existingIdx] = { ...sessions[existingIdx], ...session };
  } else {
    sessions.push(session);
  }
  
  writeJsonFile('attendance_sessions.json', sessions);
  
  if (isConnected && db) {
    try {
      await db.collection('attendance_sessions').updateOne(
        { sessionId: session.sessionId },
        { $set: session },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[MongoDB Atlas] Save session error:', e.message);
    }
  }
  
  return session;
}


async function addAuditLog(entry) {
  const audit = {
    id: 'adt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    ...entry
  };
  
  let logs = readJsonFile('audit.json', []);
  logs.unshift(audit);
  
  // keep last 5000 locally
  if (logs.length > 5000) logs = logs.slice(0, 5000);
  writeJsonFile('audit.json', logs);
  
  if (isConnected && db) {
    try {
      await db.collection('audit_logs').insertOne(audit);
    } catch (e) {
      console.warn('[MongoDB Atlas] Add audit log error:', e.message);
    }
  }
}

async function getAuditLogs() {
  if (isConnected && db) {
    try {
      return await db.collection('audit_logs').find().sort({ timestamp: -1 }).toArray();
    } catch (e) {
      console.warn('[MongoDB Atlas] Get audit logs error:', e.message);
    }
  }
  return readJsonFile('audit.json', []);
}

module.exports = {
  addAuditLog,
  getAuditLogs,
  getSessions,
  saveSession,
  getClassificationRules,
  saveClassificationRule,
  deleteClassificationRule,
  applyClassificationRules,
  connect,
  getStatus,
  getStudents,
  saveStudents,
  importStudents,
  getAttendance,
  saveAttendance,
  addAttendanceRecord,
  deleteAttendanceRecord,
  updateAttendanceRecord,
  clearAllSystemData,
  getAccounts,
  saveAccounts,
  getRules,
  saveRules,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventRegistrations,
  registerStudentsToEvent,
  unregisterStudentFromEvent
};
