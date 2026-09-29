const fs = require('fs');

let content = fs.readFileSync('db.js', 'utf8');

const sessionCode = `
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
`;

// Insert the code before module.exports
if (!content.includes('getSessions')) {
  content = content.replace('module.exports = {', sessionCode + '\nmodule.exports = {\n  getSessions,\n  saveSession,');
  fs.writeFileSync('db.js', content);
}
