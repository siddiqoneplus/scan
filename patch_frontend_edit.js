const fs = require('fs');

// --- 1. Patch index.html ---
let index = fs.readFileSync('index.html', 'utf8');

const editModal = `
  <!-- MODAL: EDIT ATTENDANCE RECORD (Admin Only) -->
  <div class="modal-backdrop" id="modalEditRecord">
    <div class="modal-box">
      <div class="modal-header">
        <h3><i class="fa-solid fa-pen-to-square modal-icon-emerald"></i> Edit Attendance Record</h3>
        <button type="button" class="btn btn-secondary btn-icon" onclick="App.closeModal('modalEditRecord')">&times;</button>
      </div>
      <form id="formEditRecord" onsubmit="App.submitEditRecord(event)">
        <input type="hidden" id="editRecordId">
        <div class="modal-body">
          <p class="text-muted" style="margin-bottom: 15px; font-size: 0.9rem;">
            <i class="fa-solid fa-circle-info"></i> Historical data cannot be silently modified. All changes are logged to the audit trail.
          </p>
          
          <div class="form-group">
            <label>Student</label>
            <input type="text" id="editRecordStudent" class="input-styled" disabled style="opacity: 0.7;">
          </div>
          
          <div class="form-group">
            <label>Original Scan Time</label>
            <input type="text" id="editRecordTime" class="input-styled" disabled style="opacity: 0.7;">
          </div>
          
          <div class="form-group">
            <label for="editRecordStatus">New Status *</label>
            <select id="editRecordStatus" class="input-styled w-full" required>
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
              <option value="Invalid">Invalid (Discard)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label for="editRecordReason">Reason for Change (Optional)</label>
            <input type="text" id="editRecordReason" class="input-styled" placeholder="e.g. Scanned wrong QR, manually verified">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal('modalEditRecord')">Cancel</button>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Confirm Edit</button>
        </div>
      </form>
    </div>
  </div>
`;

if (!index.includes('id="modalEditRecord"')) {
   index = index.replace('</body>', editModal + '\n</body>');
   fs.writeFileSync('index.html', index);
}

// --- 2. Patch js/app.js ---
let appjs = fs.readFileSync('js/app.js', 'utf8');

// Inject the edit button into renderAttendanceTable
if (!appjs.includes('App.openEditRecordModal(')) {
   appjs = appjs.replace(
      `<td class="text-right \${isAdmin ? '' : 'admin-only-el'}">
          \${isAdmin ? \`<button class="btn btn-danger btn-sm" onclick="App.deleteRecord('\${r.id}')" title="Delete record">`,
          
      `<td class="text-right \${isAdmin ? '' : 'admin-only-el'}">
          \${isAdmin ? \`<button class="btn btn-secondary btn-sm" onclick="App.openEditRecordModal('\${r.id}', '\${escapeHtml(r.rollNo)} - \${escapeHtml(r.name)}', '\${escapeHtml(r.date)} \${escapeHtml(r.timestamp)}', '\${r.status || 'Present'}')" title="Edit record" style="margin-right: 5px;">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="App.deleteRecord('\${r.id}')" title="Delete record">`
   );
   
   // We also need to display the current status differently in the table. Let's patch the Status column
   // We previously wrote: <td><span style="color:#2ed573; font-weight:bold;">PRESENT</span></td>
   // We need to change that to use r.status
   const statusHTMLRegex = /<td><span style="color:#2ed573; font-weight:bold;">PRESENT<\/span><\/td>/;
   const newStatusHTML = `<td>
      \${(!r.status || r.status === 'Present') ? '<span style="color:#2ed573; font-weight:bold;">PRESENT</span>' : 
        (r.status === 'Absent' ? '<span style="color:#ff4757; font-weight:bold;">ABSENT</span>' : 
        '<span style="color:#a4b0be; font-weight:bold;">INVALID</span>')}
      \${r.auditTrail && r.auditTrail.length > 0 ? '<i class="fa-solid fa-clock-rotate-left" style="color:var(--purple); margin-left:5px; font-size:0.8rem;" title="Edited manually"></i>' : ''}
   </td>`;
   appjs = appjs.replace(statusHTMLRegex, newStatusHTML);
}

// Inject logic functions
const editLogic = `
  function openEditRecordModal(id, studentLabel, timeLabel, currentStatus) {
    document.getElementById('editRecordId').value = id;
    document.getElementById('editRecordStudent').value = studentLabel;
    document.getElementById('editRecordTime').value = timeLabel;
    document.getElementById('editRecordStatus').value = currentStatus;
    document.getElementById('editRecordReason').value = '';
    
    openModal('modalEditRecord');
  }
  
  async function submitEditRecord(e) {
    e.preventDefault();
    const id = document.getElementById('editRecordId').value;
    const status = document.getElementById('editRecordStatus').value;
    const reason = document.getElementById('editRecordReason').value;
    
    if (!confirm('Are you sure you want to change the attendance status for this record? This action will be logged.')) return;
    
    try {
      const res = await fetch('/api/attendance?id=' + id, {
         method: 'PATCH',
         headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
         },
         body: JSON.stringify({ status, reason })
      });
      const data = await res.json();
      if (data.success) {
         showToast('Record updated successfully.', 'success');
         closeModal('modalEditRecord');
         if (typeof fetchAndRenderHistory !== 'undefined') fetchAndRenderHistory(analyticsCurrentPage);
         // Also update KPI dashboard if on the tab
         refreshAdminDashboard();
      } else {
         showToast(data.error || 'Failed to update record', 'error');
      }
    } catch(err) {
      showToast('Network error', 'error');
    }
  }
`;

if (!appjs.includes('openEditRecordModal')) {
   appjs = appjs.replace('function bindModals() {', editLogic + '\n  function bindModals() {');
   appjs = appjs.replace('updateAdminUI,', 'updateAdminUI,\n    openEditRecordModal,\n    submitEditRecord,');
   fs.writeFileSync('js/app.js', appjs);
}
console.log('Patched frontend for attendance edit');
