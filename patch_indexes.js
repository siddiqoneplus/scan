const fs = require('fs');

let dbjs = fs.readFileSync('db.js', 'utf8');

const newCreateIndexes = `async function createIndexes() {
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
       console.log(\`[Storage Engine] Removed \${idsToDelete.length} duplicate student records for RollNo: \${dup._id.rollNo}\`);
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
       console.log(\`[Storage Engine] Removed \${idsToDelete.length} duplicate attendance records for \${dup._id.rollNo} on \${dup._id.date}\`);
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
}`;

dbjs = dbjs.replace(/async function createIndexes\(\) \{[\s\S]*?catch \(err\) \{[\s\n]*console\.warn\('\[MongoDB Atlas\] Index creation note:', err\.message\);[\s\n]*\}[\s\n]*\}/, newCreateIndexes);

fs.writeFileSync('db.js', dbjs);
console.log('Patched db.js with safe duplicate handling and performance indexes.');
