const fs = require('fs');
let index = fs.readFileSync('index.html', 'utf8');

// Fix Audit Logs modal select / input
index = index.replace('<select id="auditFilterAction" class="select-styled" onchange="App.fetchAuditLogs(1)">', '<select id="auditFilterAction" class="select-styled" onchange="App.fetchAuditLogs(1)" title="Filter Action" aria-label="Filter Action">');

index = index.replace('<input type="text" id="auditFilterActor" class="input-styled" placeholder="Filter by Actor (Username)" oninput="App.delayFetchAudit()">', '<input type="text" id="auditFilterActor" class="input-styled" placeholder="Filter by Actor (Username)" oninput="App.delayFetchAudit()" title="Filter Actor" aria-label="Filter Actor">');

// Fix Analytics Subject/Employee input
index = index.replace('<input type="text" id="analyticsFilterSubject" class="input-styled" placeholder="Filter Subject..." title="Filter Subject">', '<input type="text" id="analyticsFilterSubject" class="input-styled" placeholder="Filter Subject..." title="Filter Subject" aria-label="Filter Subject">');

index = index.replace('<input type="text" id="analyticsFilterEmployee" class="input-styled" placeholder="Filter Employee..." title="Filter Employee">', '<input type="text" id="analyticsFilterEmployee" class="input-styled" placeholder="Filter Employee..." title="Filter Employee" aria-label="Filter Employee">');

// But first, let's fix missing titles in editRecord modal.
index = index.replace('<input type="hidden" id="editRecordId">', '<input type="hidden" id="editRecordId" title="Record ID" aria-label="Record ID">');
index = index.replace('<input type="text" id="editRecordStudent" class="input-styled" disabled style="opacity: 0.7;">', '<input type="text" id="editRecordStudent" class="input-styled" disabled style="opacity: 0.7;" title="Student Name" aria-label="Student Name" placeholder="Student">');
index = index.replace('<input type="text" id="editRecordTime" class="input-styled" disabled style="opacity: 0.7;">', '<input type="text" id="editRecordTime" class="input-styled" disabled style="opacity: 0.7;" title="Scan Time" aria-label="Scan Time" placeholder="Scan Time">');
index = index.replace('<select id="editRecordStatus" class="input-styled w-full" required>', '<select id="editRecordStatus" class="input-styled w-full" required title="Edit Status" aria-label="Edit Status">');
index = index.replace('<input type="text" id="editRecordReason" class="input-styled" placeholder="e.g. Scanned wrong QR, manually verified">', '<input type="text" id="editRecordReason" class="input-styled" placeholder="e.g. Scanned wrong QR, manually verified" title="Reason for Edit" aria-label="Reason for Edit">');

// Add styles to head to replace inline
const newCSS = 
"  <style>\n" +
"    .admin-dashboard-card { margin-bottom: 20px; }\n" +
"    .dashboard-toolbar { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 15px; }\n" +
"    .dashboard-toolbar h3 { margin: 0; }\n" +
"    .dashboard-loader { display: flex; flex-direction: column; align-items: center; padding: 20px; }\n" +
"    .dashboard-error { display: none; color: #ff4757; text-align: center; padding: 20px; }\n" +
"    .dashboard-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; margin-bottom: 20px; }\n" +
"    .dashboard-kpi-card { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }\n" +
"    .dashboard-kpi-label { font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px; }\n" +
"    .audit-modal-body { padding-top: 0; }\n" +
"    .audit-toolbar { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); }\n" +
"    .audit-table-wrap { max-height: 400px; overflow-y: auto; }\n" +
"    .audit-thead { position: sticky; top: 0; background: var(--bg-card); z-index: 10; }\n" +
"    .pagination-footer { display: flex; justify-content: space-between; margin-top: 15px; color: #a4b0be; font-size: 0.9rem; }\n" +
"  </style>\n</head>";

index = index.replace('</head>', newCSS);

// Now remove inline styles in dashboard
index = index.replace(/style="display: none; margin-bottom: 20px;"/g, 'class="admin-dashboard-card" style="display: none;"');
index = index.replace(/style="border-bottom: 1px solid rgba\(255,255,255,0\.1\); padding-bottom: 15px; margin-bottom: 15px;"/g, 'class="dashboard-toolbar"');
index = index.replace(/<h3 style="margin: 0;">/g, '<h3>');
index = index.replace(/style="display: flex; flex-direction: column; align-items: center; padding: 20px;"/g, 'class="dashboard-loader"');
index = index.replace(/<span style="margin-top: 10px;">/g, '<span>');
index = index.replace(/<div id="dashboardErrorText" style="margin-top: 10px;">/g, '<div id="dashboardErrorText">');
index = index.replace(/style="display: grid; grid-template-columns: repeat\(auto-fit, minmax\(130px, 1fr\)\); gap: 15px; margin-bottom: 20px;"/g, 'class="dashboard-kpi-grid"');
index = index.replace(/style="background: rgba\(255,255,255,0\.05\); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba\(255,255,255,0\.1\);"/g, 'class="dashboard-kpi-card"');
index = index.replace(/style="font-size: 0\.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;"/g, 'class="dashboard-kpi-label"');

// Remove inline styles in history pagination
index = index.replace(/style="display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-top: 1px solid rgba\(255,255,255,0\.1\);"/g, 'class="pagination-footer"');

// Remove inline styles in audit log modal
index = index.replace(/<div class="modal-body" style="padding-top: 0;">/g, '<div class="modal-body audit-modal-body">');
index = index.replace(/style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba\(255,255,255,0\.1\);"/g, 'class="section-toolbar audit-toolbar"');
index = index.replace(/style="max-height: 400px; overflow-y: auto;"/g, 'class="table-container audit-table-wrap"');
index = index.replace(/style="position: sticky; top: 0; background: var\(--bg-card\); z-index: 10;"/g, 'class="audit-thead"');
index = index.replace(/<div style="display: flex; justify-content: space-between; margin-top: 15px; color: #a4b0be; font-size: 0\.9rem;">/g, '<div class="pagination-footer">');

fs.writeFileSync('index.html', index);
console.log('Fixed IDE problems in index.html');
