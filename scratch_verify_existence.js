const fs = require('fs');

// Read files
const appJs = fs.readFileSync('js/app.js', 'utf8');
const scannerJs = fs.readFileSync('js/scanner.js', 'utf8');
const qrJs = fs.readFileSync('js/qr-generator.js', 'utf8');
const rosterJs = fs.readFileSync('js/roster.js', 'utf8');
const analyticsJs = fs.readFileSync('js/analytics.js', 'utf8');
const authJs = fs.readFileSync('js/auth.js', 'utf8');
const sessionJs = fs.readFileSync('js/session.js', 'utf8');
const eventsJs = fs.readFileSync('js/events.js', 'utf8');

// List of calls to check on App
const appCalls = [
  'switchTab', 'openDatabaseModal', 'openModal', 'handleLogout',
  'handleEventSwitch', 'registerAllStudentsToEvent', 'openManageEventsModal',
  'exportPresentTodayPDF', 'changeAnalyticsPage', 'handleManualSubmit',
  'refreshAdminDashboard', 'openBranchRulesModal', 'filterRoster',
  'exportPresentStudentsPDF', 'exportRosterCSV', 'confirmClearAllStudents',
  'clearAnalyticsDateFilter', 'exportAttendancePDF', 'exportAttendanceCSV',
  'clearAttendanceLogs', 'closeModal', 'submitAddStudent',
  'handleGoogleFormFileUpload', 'loadSampleGoogleFormTemplate',
  'submitImportGoogleForm', 'submitAddAccount', 'submitEditStudent',
  'submitClassificationRule', 'submitAddBranchRule', 'submitExportPresentModal',
  'submitDatabaseConfig', 'toggleDbUriVisibility', 'testDatabaseConnection',
  'executePermanentClear', 'submitWalkinReject', 'submitWalkinApprove',
  'submitCreateEvent', 'submitEditRecord', 'fetchAuditLogs', 'delayFetchAudit',
  'changeAuditPage', 'simulateScan', 'toggleStudentAttendance', 'openViewQR',
  'openEditStudentModal', 'deleteStudent', 'deleteRecord', 'setBtnLoading',
  'deleteBranchRuleEntry', 'deleteAccountEntry', 'activateEvent',
  'confirmDeleteEvent', 'init', 'showToast', 'openWalkinModal', 'refreshAllViews'
];

// Check App exports
// In app.js, check `return { ... }`
const returnMatch = appJs.match(/return\s*\{([\s\S]*?)\};/);
if (!returnMatch) {
  console.log('ERROR: Could not find return statement in app.js');
} else {
  const returnBlock = returnMatch[1];
  console.log('--- CHECKING APP EXPORTS ---');
  for (const fn of appCalls) {
    // Check if fn is in returnBlock or has property fn:
    const regex = new RegExp(`\\b${fn}\\b`);
    if (!regex.test(returnBlock)) {
      console.log(`[MISSING FROM App EXPORT]: App.${fn}`);
    }
  }
}

// Check other modules
console.log('\n--- CHECKING ScannerEngine ---');
const scannerMethods = ['toggleSound', 'toggleCamera', 'scanFromFile', 'startCamera', 'stopCamera', 'handleScanSuccess', 'processSecureScan', 'processRollNumber'];
for (const m of scannerMethods) {
  if (!new RegExp(`\\b${m}\\b`).test(scannerJs)) {
    console.log(`[MISSING FROM ScannerEngine]: ScannerEngine.${m}`);
  }
}

console.log('\n--- CHECKING SessionManager ---');
const sessionMethods = ['startSession', 'stopSession', 'getActiveSession', 'recordScanned'];
for (const m of sessionMethods) {
  if (!new RegExp(`\\b${m}\\b`).test(sessionJs)) {
    console.log(`[MISSING FROM SessionManager]: SessionManager.${m}`);
  }
}

console.log('\n--- CHECKING QRStudio ---');
const qrMethods = ['setFilters', 'printAllBadges', 'renderStudentBadges', 'downloadQR'];
for (const m of qrMethods) {
  if (!new RegExp(`\\b${m}\\b`).test(qrJs)) {
    console.log(`[MISSING FROM QRStudio]: QRStudio.${m}`);
  }
}
