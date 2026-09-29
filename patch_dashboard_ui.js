const fs = require('fs');

// 1. Patch index.html
let index = fs.readFileSync('index.html', 'utf8');

const dashboardHTML = `
      <!-- Admin Dashboard -->
      <div class="admin-card admin-only-el" id="adminDashboardCard" style="display: none; margin-bottom: 20px;">
        <div class="section-toolbar" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 15px;">
          <h3 style="margin: 0;"><i class="fa-solid fa-chart-line"></i> Admin Overview</h3>
          <button class="btn btn-secondary btn-sm" onclick="App.refreshAdminDashboard()">
             <i class="fa-solid fa-rotate-right"></i> Refresh
          </button>
        </div>
        
        <div id="dashboardLoader" style="display: flex; flex-direction: column; align-items: center; padding: 20px;">
           <i class="fa-solid fa-circle-notch fa-spin fa-2x mb-2" style="color: var(--cyan);"></i>
           <span style="margin-top: 10px;">Loading statistics...</span>
        </div>
        <div id="dashboardError" style="display: none; color: #ff4757; text-align: center; padding: 20px;">
           <i class="fa-solid fa-circle-xmark fa-2x mb-2"></i>
           <div id="dashboardErrorText" style="margin-top: 10px;">Failed to load data.</div>
        </div>
        
        <div id="dashboardContent" style="display: none;">
          <div class="dashboard-kpis" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; margin-bottom: 20px;">
            <div class="kpi-card" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
               <div style="font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;">Total Students</div>
               <div style="font-size: 1.8rem; font-weight: bold; color: var(--cyan);" id="dashTotalStudents">0</div>
            </div>
            <div class="kpi-card" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
               <div style="font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;">Employees</div>
               <div style="font-size: 1.8rem; font-weight: bold; color: var(--purple);" id="dashTotalEmployees">0</div>
            </div>
            <div class="kpi-card" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
               <div style="font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;">Sessions Today</div>
               <div style="font-size: 1.8rem; font-weight: bold; color: var(--emerald);" id="dashTotalSessions">0</div>
            </div>
            <div class="kpi-card" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
               <div style="font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;">Present Today</div>
               <div style="font-size: 1.8rem; font-weight: bold; color: #2ed573;" id="dashTotalPresent">0</div>
            </div>
            <div class="kpi-card" style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
               <div style="font-size: 0.75rem; color: #a4b0be; text-transform: uppercase; margin-bottom: 5px;">Absent Today</div>
               <div style="font-size: 1.8rem; font-weight: bold; color: #ff4757;" id="dashTotalAbsent">0</div>
            </div>
          </div>
          
          <h4 style="margin-bottom: 10px; font-weight: 500;">Today's Sessions</h4>
          <div class="table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Period</th>
                  <th>Section</th>
                  <th>Employee</th>
                  <th>Present/Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="dashboardSessionsTable">
                <!-- Rows injected by JS -->
              </tbody>
            </table>
          </div>
          <div id="dashboardEmptySessions" style="display: none; text-align: center; padding: 20px; color: #a4b0be; background: rgba(255,255,255,0.02); border-radius: 8px;">
             <i class="fa-solid fa-bed" style="font-size: 1.5rem; margin-bottom: 10px;"></i><br>
             No attendance sessions have been created today.
          </div>
        </div>
      </div>
`;

if (!index.includes('id="adminDashboardCard"')) {
   index = index.replace('<!-- Google Form Integration Info Banner -->', dashboardHTML + '\n      <!-- Google Form Integration Info Banner -->');
   fs.writeFileSync('index.html', index);
}


// 2. Patch js/app.js
let appjs = fs.readFileSync('js/app.js', 'utf8');

const dashboardJS = `
  async function refreshAdminDashboard() {
    const card = document.getElementById('adminDashboardCard');
    const loader = document.getElementById('dashboardLoader');
    const content = document.getElementById('dashboardContent');
    const errorDiv = document.getElementById('dashboardError');
    const errorText = document.getElementById('dashboardErrorText');
    const emptyDiv = document.getElementById('dashboardEmptySessions');
    const tbody = document.getElementById('dashboardSessionsTable');
    
    if (!card) return;
    
    // Only fetch if admin
    const session = AuthManager.getSession();
    if (!session || session.role !== 'admin') {
       card.style.display = 'none';
       return;
    }
    
    card.style.display = 'block';
    loader.style.display = 'flex';
    content.style.display = 'none';
    errorDiv.style.display = 'none';
    
    try {
      const res = await fetch('/api/admin/dashboard', {
         headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
      });
      const data = await res.json();
      
      loader.style.display = 'none';
      
      if (!res.ok || !data.success) {
         errorText.innerText = data.error || 'Failed to load dashboard data.';
         errorDiv.style.display = 'block';
         return;
      }
      
      content.style.display = 'block';
      
      document.getElementById('dashTotalStudents').innerText = data.totalStudents;
      document.getElementById('dashTotalEmployees').innerText = data.totalEmployees;
      document.getElementById('dashTotalSessions').innerText = data.totalSessions;
      document.getElementById('dashTotalPresent').innerText = data.presentCount;
      document.getElementById('dashTotalAbsent').innerText = data.absentCount;
      
      if (data.sessionsToday && data.sessionsToday.length > 0) {
         emptyDiv.style.display = 'none';
         tbody.parentNode.style.display = 'table';
         tbody.innerHTML = '';
         
         data.sessionsToday.forEach(s => {
            const tr = document.createElement('tr');
            
            const statusColor = s.status === 'active' ? '#2ed573' : '#a4b0be';
            const statusLabel = s.status === 'active' ? 'Active' : 'Completed';
            
            tr.innerHTML = \`
              <td><strong>\${escapeHtml(s.subject)}</strong></td>
              <td>\${escapeHtml(s.period)}</td>
              <td><span class="tag tag-section">Sec \${escapeHtml(s.section)}</span></td>
              <td><i class="fa-solid fa-user-tie" style="color:#a4b0be;"></i> \${escapeHtml(s.employee)}</td>
              <td><strong>\${s.presentCount}</strong> / \${s.totalCount}</td>
              <td><span style="color: \${statusColor}; font-weight:bold;">\${statusLabel}</span></td>
            \`;
            tbody.appendChild(tr);
         });
      } else {
         emptyDiv.style.display = 'block';
         tbody.parentNode.style.display = 'none';
      }
      
    } catch (err) {
      loader.style.display = 'none';
      errorText.innerText = 'Network error loading dashboard.';
      errorDiv.style.display = 'block';
    }
  }
`;

if (!appjs.includes('refreshAdminDashboard')) {
   appjs = appjs.replace('function switchTab(tabId) {', dashboardJS + '\n\n  function switchTab(tabId) {');
   
   // We also need to inject it into `switchTab` or init
   appjs = appjs.replace("updateAdminUI();", "updateAdminUI();\n      if(tabId === 'roster') refreshAdminDashboard();");
   
   // Expose to App
   appjs = appjs.replace('updateAdminUI,', 'updateAdminUI,\n    refreshAdminDashboard,');
   fs.writeFileSync('js/app.js', appjs);
}
console.log("Patched App Dashboard UI");
