const fs = require('fs');

let index = fs.readFileSync('index.html', 'utf8');

const auditBtn = `
            <button class="btn btn-secondary btn-sm" onclick="App.openAuditViewer()" title="View System Audit Logs">
              <i class="fa-solid fa-clock-rotate-left"></i> Audit Logs
            </button>
`;

if (!index.includes('App.openAuditViewer()')) {
   index = index.replace('<button class="btn btn-primary btn-sm" onclick="App.openModal(\\\'modalAddStudent\\\')" title="Register single student">', auditBtn + '\n            <button class="btn btn-primary btn-sm" onclick="App.openModal(\'modalAddStudent\')" title="Register single student">');
}

const auditModal = `
  <!-- MODAL: AUDIT LOGS VIEWER (Admin Only) -->
  <div class="modal-backdrop" id="modalAuditViewer">
    <div class="modal-box" style="max-width: 1000px;">
      <div class="modal-header">
        <h3><i class="fa-solid fa-shield-halved modal-icon-emerald"></i> System Audit Logs</h3>
        <button type="button" class="btn btn-secondary btn-icon" onclick="App.closeModal('modalAuditViewer')">&times;</button>
      </div>
      <div class="modal-body" style="padding-top: 0;">
        <div class="section-toolbar" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
          <div class="search-filter-group">
            <select id="auditFilterAction" class="select-styled" onchange="App.fetchAuditLogs(1)">
              <option value="">All Actions</option>
              <option value="login">Login</option>
              <option value="employee created">Employee Created</option>
              <option value="employee updated">Employee Updated</option>
              <option value="employee deactivated">Employee Deactivated</option>
              <option value="student created">Student Created</option>
              <option value="student updated">Student Updated</option>
              <option value="student deactivated">Student Deactivated</option>
              <option value="attendance session started">Session Started</option>
              <option value="attendance session stopped">Session Stopped</option>
              <option value="attendance modified">Attendance Modified</option>
              <option value="important configuration changes">Config Changes</option>
            </select>
            <input type="text" id="auditFilterActor" class="input-styled" placeholder="Filter by Actor (Username)" oninput="App.delayFetchAudit()">
            <button class="btn btn-secondary btn-sm" onclick="App.fetchAuditLogs(1)"><i class="fa-solid fa-rotate-right"></i> Refresh</button>
          </div>
        </div>
        
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table class="custom-table">
            <thead style="position: sticky; top: 0; background: var(--bg-card); z-index: 10;">
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Resource / Target</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
               <tr><td colspan="6" style="text-align:center;">Loading audit logs...</td></tr>
            </tbody>
          </table>
        </div>
        
        <div style="display: flex; justify-content: space-between; margin-top: 15px; color: #a4b0be; font-size: 0.9rem;">
           <div>Showing <span id="auditPageIndicator">Page 1</span></div>
           <div class="flex-gap-xs">
             <button class="btn btn-secondary btn-sm" id="btnAuditPrev" onclick="App.changeAuditPage(-1)"><i class="fa-solid fa-chevron-left"></i> Prev</button>
             <button class="btn btn-secondary btn-sm" id="btnAuditNext" onclick="App.changeAuditPage(1)">Next <i class="fa-solid fa-chevron-right"></i></button>
           </div>
        </div>
      </div>
    </div>
  </div>
`;

if (!index.includes('id="modalAuditViewer"')) {
   index = index.replace('</body>', auditModal + '\n</body>');
   fs.writeFileSync('index.html', index);
}

// 2. Patch app.js
let appjs = fs.readFileSync('js/app.js', 'utf8');

const auditJS = `
  let auditCurrentPage = 1;
  let auditTotalPages = 1;
  let auditDelayTimer = null;
  
  function delayFetchAudit() {
     clearTimeout(auditDelayTimer);
     auditDelayTimer = setTimeout(() => fetchAuditLogs(1), 400);
  }

  function openAuditViewer() {
    openModal('modalAuditViewer');
    fetchAuditLogs(1);
  }
  
  function changeAuditPage(delta) {
    const newPage = auditCurrentPage + delta;
    if (newPage >= 1 && newPage <= auditTotalPages) {
       fetchAuditLogs(newPage);
    }
  }
  
  async function fetchAuditLogs(page = 1) {
    const actionFilter = document.getElementById('auditFilterAction').value;
    const actorFilter = document.getElementById('auditFilterActor').value;
    
    const query = new URLSearchParams({ page: page, limit: 50 });
    if (actionFilter) query.append('action', actionFilter);
    if (actorFilter) query.append('actor', actorFilter);
    
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading logs...</td></tr>';
    
    try {
       const res = await fetch('/api/audit?' + query.toString(), {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
       });
       const data = await res.json();
       
       if (data.success) {
          auditCurrentPage = data.pagination.page;
          auditTotalPages = data.pagination.totalPages;
          
          document.getElementById('auditPageIndicator').innerText = \`Page \${auditCurrentPage} of \${Math.max(1, auditTotalPages)} (Total: \${data.pagination.total})\`;
          document.getElementById('btnAuditPrev').disabled = auditCurrentPage <= 1;
          document.getElementById('btnAuditNext').disabled = auditCurrentPage >= auditTotalPages;
          
          if (data.data.length === 0) {
             tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#a4b0be;">No audit logs found.</td></tr>';
          } else {
             tbody.innerHTML = data.data.map(log => {
                const date = new Date(log.timestamp).toLocaleString();
                const metaStr = Object.keys(log.metadata || {}).length > 0 ? JSON.stringify(log.metadata) : '-';
                
                let actionColor = 'var(--cyan)';
                if (log.action.includes('deleted') || log.action.includes('deactivated')) actionColor = '#ff4757';
                else if (log.action.includes('started') || log.action.includes('created')) actionColor = '#2ed573';
                else if (log.action.includes('login')) actionColor = 'var(--purple)';
                else if (log.action.includes('modified') || log.action.includes('updated')) actionColor = '#ffa502';
                
                return \`
                  <tr>
                    <td style="font-family:monospace; color:#a4b0be; white-space:nowrap;">\${date}</td>
                    <td><strong style="color:white;">\${escapeHtml(log.actor)}</strong></td>
                    <td><span class="tag tag-branch" style="padding:2px 6px; font-size:0.75rem;">\${escapeHtml(log.role)}</span></td>
                    <td><span style="color:\${actionColor}; font-weight:bold; text-transform:uppercase; font-size:0.8rem;">\${escapeHtml(log.action)}</span></td>
                    <td style="font-family:monospace; color:var(--text-main);">\${escapeHtml(log.resource)}</td>
                    <td style="font-size:0.8rem; color:#a4b0be; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title='\${escapeHtml(metaStr)}'>\${escapeHtml(metaStr)}</td>
                  </tr>
                \`;
             }).join('');
          }
       } else {
          tbody.innerHTML = \`<tr><td colspan="6" style="text-align:center; color:#ff4757;">\${escapeHtml(data.error || 'Failed to load logs')}</td></tr>\`;
       }
    } catch (e) {
       tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ff4757;">Network error.</td></tr>';
    }
  }
`;

if (!appjs.includes('openAuditViewer')) {
   appjs = appjs.replace('function bindModals() {', auditJS + '\n  function bindModals() {');
   appjs = appjs.replace('updateAdminUI,', 'updateAdminUI,\n    openAuditViewer,\n    changeAuditPage,\n    fetchAuditLogs,\n    delayFetchAudit,');
   fs.writeFileSync('js/app.js', appjs);
}
console.log('Patched frontend UI for audit logs');
