const fs = require('fs');

let index = fs.readFileSync('index.html', 'utf8');

// 1. Add pagination to Roster tab
const rosterPagination = `
        <div id="rosterPagination" class="pagination-footer" style="margin-bottom: 20px;">
           <div style="color: #a4b0be; font-size: 0.9rem;">
             Showing <span id="rosterPageStart">0</span>-<span id="rosterPageEnd">0</span> of <span id="rosterPageTotal">0</span>
           </div>
           <div class="flex-gap-xs">
             <button class="btn btn-secondary btn-sm" id="btnRosterPrev" onclick="App.changeRosterPage(-1)"><i class="fa-solid fa-chevron-left"></i> Prev</button>
             <span style="padding: 0 10px; align-self: center;" id="rosterPageIndicator">Page 1 / 1</span>
             <button class="btn btn-secondary btn-sm" id="btnRosterNext" onclick="App.changeRosterPage(1)">Next <i class="fa-solid fa-chevron-right"></i></button>
           </div>
        </div>
`;

if (!index.includes('id="rosterPagination"')) {
   index = index.replace('<!-- MODAL: ADD STUDENT -->', rosterPagination + '\n    <!-- MODAL: ADD STUDENT -->');
}

// 2. Add Export CSV button to Roster tab
const exportBtn = `
            <button class="btn btn-secondary btn-sm admin-only-el" onclick="App.exportRosterCSV()" title="Export all students to CSV">
              <i class="fa-solid fa-file-csv"></i> Export Data
            </button>
`;
if (!index.includes('App.exportRosterCSV()')) {
   index = index.replace('<button class="btn btn-secondary btn-sm" onclick="App.openModal(\'modalImportStudents\')" title="Import from CSV">', exportBtn + '\n            <button class="btn btn-secondary btn-sm" onclick="App.openModal(\'modalImportStudents\')" title="Import from CSV">');
}

// 3. Add QR Modal
const qrModal = `
  <!-- MODAL: VIEW QR -->
  <div class="modal-backdrop" id="modalViewQR">
    <div class="modal-box" style="text-align: center; max-width: 400px;">
      <div class="modal-header">
        <h3><i class="fa-solid fa-qrcode modal-icon-emerald"></i> Student QR Code</h3>
        <button type="button" class="btn btn-secondary btn-icon" onclick="App.closeModal('modalViewQR')">&times;</button>
      </div>
      <div class="modal-body">
        <h4 id="qrStudentName" style="color: white; margin-bottom: 5px;">Student Name</h4>
        <p id="qrStudentRoll" class="font-mono text-subtle" style="margin-bottom: 20px;">ROLL NO</p>
        
        <div id="qrCodeContainer" style="background: white; padding: 20px; border-radius: 10px; display: inline-block; margin-bottom: 20px;">
           <canvas id="qrCanvas"></canvas>
        </div>
        
        <div class="flex-gap" style="justify-content: center;">
           <button class="btn btn-secondary" onclick="App.downloadQR()"><i class="fa-solid fa-download"></i> Download</button>
           <button class="btn btn-primary" onclick="App.printQR()"><i class="fa-solid fa-print"></i> Print</button>
        </div>
      </div>
    </div>
  </div>
`;

if (!index.includes('id="modalViewQR"')) {
   index = index.replace('</body>', qrModal + '\n</body>');
   fs.writeFileSync('index.html', index);
}

// Now patch app.js
let appjs = fs.readFileSync('js/app.js', 'utf8');

// Replace renderRosterTable with fetchAndRenderRoster
const newRosterLogic = `
  let rosterCurrentPage = 1;
  let rosterTotalPages = 1;
  let rosterDelayTimer = null;

  function delayFetchRoster() {
     clearTimeout(rosterDelayTimer);
     rosterDelayTimer = setTimeout(() => fetchAndRenderRoster(1), 300);
  }

  function changeRosterPage(delta) {
    const newPage = rosterCurrentPage + delta;
    if (newPage >= 1 && newPage <= rosterTotalPages) {
       fetchAndRenderRoster(newPage);
    }
  }

  async function toggleStudentStatus(rollNo) {
     if (!confirm(\`Are you sure you want to toggle the status for student \${rollNo}?\`)) return;
     try {
       const res = await fetch('/api/roster/student', {
          method: 'PATCH',
          headers: {
             'Content-Type': 'application/json',
             'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
          },
          body: JSON.stringify({ rollNo, action: 'toggle_status' })
       });
       const data = await res.json();
       if (data.success) {
          showToast(\`Student status updated to \${data.student.status}\`, 'success');
          fetchAndRenderRoster(rosterCurrentPage);
       } else {
          showToast(data.error || 'Failed to update status', 'error');
       }
     } catch(e) {
       showToast('Network error', 'error');
     }
  }

  function viewQR(rollNo, name) {
     document.getElementById('qrStudentName').innerText = name;
     document.getElementById('qrStudentRoll').innerText = rollNo;
     openModal('modalViewQR');
     
     // We need a QR generation library. Since we don't have one imported, 
     // we can use a public API for display or prompt the user to use the CLI.
     // Assuming we can use a free API for the frontend canvas
     const canvas = document.getElementById('qrCanvas');
     const ctx = canvas.getContext('2d');
     ctx.clearRect(0,0, canvas.width, canvas.height);
     ctx.fillStyle = '#a4b0be';
     ctx.font = '12px Arial';
     ctx.fillText('QR Code generation requires', 10, 50);
     ctx.fillText('a frontend QR library.', 10, 70);
  }

  function downloadQR() { showToast('Download QR not implemented without library', 'info'); }
  function printQR() { window.print(); }

  async function exportRosterCSV() {
     showToast('Generating CSV...', 'info');
     try {
        const res = await fetch('/api/roster?limit=100000', {
           headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
        });
        const data = await res.json();
        if (data.success) {
           let csv = 'Roll Number,Name,Branch,Year,Section,Status\\n';
           data.students.forEach(s => {
              csv += \`"\${s.rollNo}","\${s.name}","\${s.branch}","\${s.year}","\${s.section || ''}","\${s.status}"\\n\`;
           });
           const blob = new Blob([csv], { type: 'text/csv' });
           const url = window.URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = 'students_export.csv';
           a.click();
        }
     } catch(e) {
        showToast('Export failed', 'error');
     }
  }

  async function fetchAndRenderRoster(page = 1) {
    const q = document.getElementById('rosterSearch')?.value || '';
    const b = document.getElementById('rosterFilterBranch')?.value || 'ALL';
    const y = document.getElementById('rosterFilterYear')?.value || 'ALL';
    const a = document.getElementById('rosterFilterAssigned')?.value || 'ALL';
    const sec = document.getElementById('rosterFilterSection')?.value || 'ALL';

    const query = new URLSearchParams({ page: page, limit: 50 });
    if (q) query.append('query', q);
    if (b !== 'ALL') query.append('branch', b);
    if (y !== 'ALL') query.append('year', y);
    if (a !== 'ALL') query.append('assigned', a);
    if (sec !== 'ALL') query.append('section', sec);

    const tbody = document.getElementById('rosterTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading students...</td></tr>';
    
    try {
       const res = await fetch('/api/roster?' + query.toString(), {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
       });
       const data = await res.json();
       
       if (data.success) {
          rosterCurrentPage = data.pagination.page;
          rosterTotalPages = data.pagination.totalPages;
          
          const pageStartEl = document.getElementById('rosterPageStart');
          if(pageStartEl) pageStartEl.innerText = data.pagination.total === 0 ? 0 : ((rosterCurrentPage - 1) * data.pagination.limit) + 1;
          
          const pageEndEl = document.getElementById('rosterPageEnd');
          if(pageEndEl) pageEndEl.innerText = Math.min(rosterCurrentPage * data.pagination.limit, data.pagination.total);
          
          const pageTotalEl = document.getElementById('rosterPageTotal');
          if(pageTotalEl) pageTotalEl.innerText = data.pagination.total;
          
          const pageIndEl = document.getElementById('rosterPageIndicator');
          if(pageIndEl) pageIndEl.innerText = \`Page \${rosterCurrentPage} / \${Math.max(1, rosterTotalPages)}\`;
          
          const btnPrev = document.getElementById('btnRosterPrev');
          if(btnPrev) btnPrev.disabled = rosterCurrentPage <= 1;
          
          const btnNext = document.getElementById('btnRosterNext');
          if(btnNext) btnNext.disabled = rosterCurrentPage >= rosterTotalPages;
          
          renderRosterTableRows(data.students);
       }
    } catch(e) {
       tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#ff4757;">Failed to load roster</td></tr>';
    }
  }

  function renderRosterTableRows(students) {
    const tbody = document.getElementById('rosterTableBody');
    const isAdmin = AuthManager.isAdmin();

    if (students.length === 0) {
      tbody.innerHTML = \`
        <tr>
          <td colspan="9" class="empty-placeholder" style="padding: 2.5rem 1rem; text-align: center;">
            <i class="fa-solid fa-folder-open" style="font-size: 2rem; opacity: 0.35; display: block; margin-bottom: 0.6rem;"></i>
            No student records found. Use <strong>"Add Student"</strong> or <strong>"Import CSV"</strong> above to register students.
          </td>
        </tr>
      \`;
      return;
    }

    tbody.innerHTML = students.map((s, idx) => {
      const isSharedAll = !s.assignedTo || s.assignedTo === 'all';
      const sectionLabel = s.section ? s.section : '—';
      const statusHtml = s.status === 'inactive' ? '<span class="tag tag-absent">Inactive</span>' : '<span class="tag tag-present">Active</span>';
      
      return \`
        <tr style="\${s.status === 'inactive' ? 'opacity: 0.6;' : ''}">
          <td class="text-subtle col-w-50">\${idx + 1 + ((rosterCurrentPage - 1) * 50)}</td>
          <td class="font-mono font-semibold text-white">\${escapeHtml(s.rollNo)}</td>
          <td><strong>\${escapeHtml(s.name)}</strong></td>
          <td><span class="tag tag-branch">\${escapeHtml(s.branch)}</span></td>
          <td><span class="tag tag-section">\${escapeHtml(sectionLabel)}</span></td>
          <td><span class="tag tag-year">\${escapeHtml(s.year)}</span></td>
          <td>\${statusHtml}</td>
          <td class="text-right \${isAdmin ? '' : 'admin-only-el'}">
            <div class="row-action-btns">
              \${isAdmin ? \`
                <button class="btn btn-secondary btn-sm" onclick="App.toggleStudentStatus('\${s.rollNo}')" title="\${s.status === 'inactive' ? 'Activate Student' : 'Deactivate Student'}">
                  <i class="fa-solid \${s.status === 'inactive' ? 'fa-user-check' : 'fa-user-slash'}"></i>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="App.openEditStudentModal('\${s.rollNo}')" title="Edit Student Profile">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              \` : ''}
              <button class="btn btn-secondary btn-sm" onclick="App.viewQR('\${s.rollNo}', '\${escapeHtml(s.name)}')" title="View QR Code">
                <i class="fa-solid fa-qrcode"></i>
              </button>
              \${isAdmin ? \`
                <button class="btn btn-danger btn-sm" onclick="App.deleteStudent('\${s.rollNo}')" title="Delete Student">
                  <i class="fa-solid fa-trash"></i>
                </button>
              \` : ''}
            </div>
          </td>
        </tr>
      \`;
    }).join('');
  }
`;

appjs = appjs.replace(/function renderRosterTable\(.*?\}[\s\S]*?\}\s*function bindAnalyticsUI\(\) \{/, newRosterLogic + '\n  function bindAnalyticsUI() {');

// Fix the roster tab bind events
appjs = appjs.replace("document.getElementById('rosterSearch')?.addEventListener('input', () => renderRosterTable());", "document.getElementById('rosterSearch')?.addEventListener('input', () => delayFetchRoster());");
appjs = appjs.replace("document.getElementById('rosterFilterBranch')?.addEventListener('change', () => renderRosterTable());", "document.getElementById('rosterFilterBranch')?.addEventListener('change', () => delayFetchRoster());");
appjs = appjs.replace("document.getElementById('rosterFilterYear')?.addEventListener('change', () => renderRosterTable());", "document.getElementById('rosterFilterYear')?.addEventListener('change', () => delayFetchRoster());");
appjs = appjs.replace("document.getElementById('rosterFilterAssigned')?.addEventListener('change', () => renderRosterTable());", "document.getElementById('rosterFilterAssigned')?.addEventListener('change', () => delayFetchRoster());");
appjs = appjs.replace("document.getElementById('rosterFilterSection')?.addEventListener('change', () => renderRosterTable());", "document.getElementById('rosterFilterSection')?.addEventListener('change', () => delayFetchRoster());");

// Hook updateAdminUI to fetch roster
appjs = appjs.replace(/function updateAdminUI\(\) \{[\s\S]*?renderRosterTable\(\);/, "function updateAdminUI() {\n    const isAdmin = AuthManager.isAdmin();\n    document.querySelectorAll('.admin-only-el').forEach(el => el.style.display = isAdmin ? '' : 'none');\n    fetchAndRenderRoster(1);");

// Ensure methods are exposed
appjs = appjs.replace('updateAdminUI,', 'updateAdminUI,\n    changeRosterPage,\n    toggleStudentStatus,\n    viewQR,\n    downloadQR,\n    printQR,\n    exportRosterCSV,');

fs.writeFileSync('js/app.js', appjs);
console.log('Patched frontend UI for Student Management');
