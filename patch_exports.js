const fs = require('fs');

// --- 1. Patch server.js to support 'query' (search by Roll No/Name) in History API ---
let server = fs.readFileSync('server.js', 'utf8');

const newFilterLogic = `
           const query = urlParams.get('query');
           
           if (query) {
               const q = query.toLowerCase();
               filtered = filtered.filter(l => (l.rollNo && l.rollNo.toLowerCase().includes(q)) || (l.name && l.name.toLowerCase().includes(q)));
           }
           
           if (startDate) {
`;

if (!server.includes("urlParams.get('query')")) {
    server = server.replace('if (startDate) {', newFilterLogic);
}

fs.writeFileSync('server.js', server);
console.log('Patched server.js for history query support');


// --- 2. Patch app.js to use backend for exports ---
let appjs = fs.readFileSync('js/app.js', 'utf8');

const exportOverrides = `
  async function fetchExportData(scope = 'today', options = {}) {
     const today = AttendanceManager.getTodayDateStr();
     const queryParams = new URLSearchParams({ limit: 100000 });
     
     if (scope === 'today') {
        queryParams.append('startDate', today);
        queryParams.append('endDate', today);
     } else if (scope === 'filtered') {
        const startDate = document.getElementById('analyticsFilterStartDate')?.value;
        const endDate = document.getElementById('analyticsFilterEndDate')?.value;
        const branch = document.getElementById('analyticsFilterBranch')?.value;
        const year = document.getElementById('analyticsFilterYear')?.value;
        const section = document.getElementById('analyticsFilterSection')?.value;
        const subject = document.getElementById('analyticsFilterSubject')?.value;
        const employee = document.getElementById('analyticsFilterEmployee')?.value;
        const search = document.getElementById('analyticsSearch')?.value;
        
        if (startDate) queryParams.append('startDate', startDate);
        if (endDate) queryParams.append('endDate', endDate);
        if (branch && branch !== 'ALL') queryParams.append('branch', branch);
        if (year && year !== 'ALL') queryParams.append('year', year);
        if (section && section !== 'ALL') queryParams.append('section', section);
        if (subject) queryParams.append('subject', subject);
        if (employee) queryParams.append('employee', employee);
        if (search) queryParams.append('query', search);
     }
     
     const res = await fetch('/api/attendance/history?' + queryParams.toString(), {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
     });
     const data = await res.json();
     if (!data.success) throw new Error(data.error || 'Failed to fetch export data from server');
     return data.data; // The array of logs
  }

  async function exportAttendanceCSV() {
    try {
      showToast('Compiling CSV from backend...', 'info');
      const records = await fetchExportData('filtered');
      if (records.length === 0) {
        showToast('No attendance records found matching current filters.', 'warning');
        return;
      }
      AttendanceManager.exportCSV(records);
      showToast(\`Exported \${records.length} attendance records as CSV!\`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  async function exportAttendancePDF() {
    try {
      showToast('Generating PDF from backend...', 'info');
      const records = await fetchExportData('filtered');
      
      if (records.length === 0) {
        showToast('No attendance records found matching current filters.', 'warning');
        return;
      }

      AttendanceManager.exportPDF(records, {
        title: 'Present Students Attendance Report',
        dateStr: AttendanceManager.getTodayDateStr(),
        sessionName: 'Filtered View',
        filterDesc: 'Filtered Records Export',
        uniqueOnly: false,
        includeSummary: true
      });
      showToast(\`Downloaded PDF report (\${records.length} records)!\`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  async function exportPresentTodayPDF() {
    try {
      showToast('Generating PDF from backend...', 'info');
      const records = await fetchExportData('today');

      if (records.length === 0) {
        showToast('No students have checked in as present today yet.', 'warning');
        return;
      }

      const uniqueRecords = AttendanceManager.deduplicateRecords(records);

      AttendanceManager.exportPDF(uniqueRecords, {
        title: "Today's Present Students Report",
        dateStr: \`\${AttendanceManager.getTodayDateStr()} (Today)\`,
        sessionName: 'Daily Check-ins',
        filterDesc: 'Today Check-ins (Unique Students)',
        uniqueOnly: true,
        includeSummary: true
      });
      showToast(\`Downloaded PDF for \${uniqueRecords.length} present students!\`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  async function exportPresentStudentsPDF() {
     return exportPresentTodayPDF();
  }

  async function submitExportPresentModal(event) {
    if (event) event.preventDefault();

    try {
      const form = document.getElementById('formExportPresent');
      const scope = form.elements['exportScope']?.value || 'today';
      const format = form.elements['exportFormat']?.value || 'pdf';
      const uniqueOnly = document.getElementById('exportUniqueOnly')?.checked ?? true;
      const includeSummary = document.getElementById('exportIncludeSummary')?.checked ?? true;

      showToast('Fetching dataset from server...', 'info');
      const records = await fetchExportData(scope);

      if (records.length === 0) {
        showToast('No records match the selected scope.', 'warning');
        return;
      }

      const finalRecords = uniqueOnly ? AttendanceManager.deduplicateRecords(records) : records;
      
      let title = scope === 'today' ? "Today's Present Students Report" : (scope === 'filtered' ? 'Filtered Attendance Records Report' : 'All Historical Attendance Records');
      let dateStr = scope === 'today' ? AttendanceManager.getTodayDateStr() : (scope === 'filtered' ? 'Filtered Dates' : 'All-Time Records');
      let filterDesc = scope === 'today' ? 'Today Check-ins' : (scope === 'filtered' ? 'Custom Report' : 'Complete Archive');

      if (format === 'csv') {
        AttendanceManager.exportCSV(finalRecords, { uniqueOnly, filename: \`Export_\${scope}_\${Date.now()}.csv\` });
      } else if (format === 'print') {
        AttendanceManager.exportPDF(finalRecords, { title, dateStr, sessionName: 'Attendance', filterDesc, includeSummary });
        // The pdf library opens print dialog if print options are passed, 
        // for now just generating PDF since we don't have a native HTML print format for 10k rows
      } else {
        AttendanceManager.exportPDF(finalRecords, { title, dateStr, sessionName: 'Attendance', filterDesc, includeSummary });
      }

      closeModal('modalExportPresent');
      showToast(\`Official Report exported (\${finalRecords.length} records).\`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }
`;

// Replace the old functions
appjs = appjs.replace(/function exportAttendanceCSV\(\) \{[\s\S]*?\}[\s\n]*\/\*\*[\s\S]*?function submitExportPresentModal\(event\) \{[\s\S]*?\}\s*\}/, exportOverrides);
// Also in case it didn't match perfectly, just replace them manually by chunk if needed. 
// Wait, regex might fail if it's too large. Let's do string replacement.

const startCSV = "function exportAttendanceCSV() {";
const endSubmit = "function submitExportPresentModal(event) {";
const endBlock = "closeModal('modalExportPresent');\n      showToast(`Official Report exported (${finalRecords.length} records).`, 'success');\n    } catch (e) {\n      showToast(e.message, 'warning');\n    }\n  }";

if (appjs.includes(startCSV) && appjs.includes(endSubmit)) {
   const before = appjs.substring(0, appjs.indexOf(startCSV));
   // Find the end of submitExportPresentModal
   const funcStr = "function submitExportPresentModal(event) {";
   const startIdx = appjs.indexOf(funcStr);
   let openBraces = 0;
   let i = startIdx + funcStr.length;
   while (i < appjs.length) {
      if (appjs[i] === '{') openBraces++;
      if (appjs[i] === '}') {
         if (openBraces === 0) {
            break;
         }
         openBraces--;
      }
      i++;
   }
   const after = appjs.substring(i + 1);
   appjs = before + "\n" + exportOverrides + "\n" + after;
   fs.writeFileSync('js/app.js', appjs);
   console.log('Patched app.js for backend exports');
} else {
   console.log('Could not find export functions to replace in app.js');
}
