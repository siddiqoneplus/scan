const fs = require('fs');

// 1. Include session.js in index.html
let index = fs.readFileSync('index.html', 'utf8');
if (!index.includes('session.js')) {
   index = index.replace('<script src="js/scanner.js"></script>', '<script src="js/session.js"></script>\n  <script src="js/scanner.js"></script>');
   
   // Set initial overlay state on load
   index = index.replace('<div class="scan-overlay" id="scanFrameOverlay">', '<div class="scan-overlay" id="scanFrameOverlay" style="display:none;">');
   fs.writeFileSync('index.html', index);
}

// 2. Modify scanner.js to check SessionManager and send session
let scanner = fs.readFileSync('js/scanner.js', 'utf8');

// Stop processing scan if no active session
const checkSession = `
    const activeSession = typeof SessionManager !== 'undefined' ? SessionManager.getActiveSession() : null;
    if (!activeSession) {
      updateStatus('No active attendance session!', 'error');
      playSound('error');
      isScanning = false;
      return;
    }
`;
scanner = scanner.replace('    const parsed = parseQRData(decodedText);', checkSession + '\n    const parsed = parseQRData(decodedText);');

// Replace event-based body with session-based body
const submitBody = `
      // Construct payload for Session
      const payload = {
        rollNo,
        session: activeSession.sessionId,
        status: 'Present'
      };
`;

scanner = scanner.replace(/\/\/ Construct payload for API[\s\S]*?const payload = \{[\s\S]*?\};/, submitBody);

// Update last scanned student via SessionManager
const recordScan = `
        if (typeof SessionManager !== 'undefined') {
           SessionManager.recordScanned(studentName);
        }
`;
scanner = scanner.replace("playSound('success');", "playSound('success');\n" + recordScan);

fs.writeFileSync('js/scanner.js', scanner);
console.log("Patched UI integration.");
