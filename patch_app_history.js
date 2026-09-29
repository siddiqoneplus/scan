const fs = require('fs');

let appjs = fs.readFileSync('js/app.js', 'utf8');

// 1. Replace bindAnalyticsFilters
const oldBindFiltersRegex = /function bindAnalyticsFilters\(\) \{[\s\S]*?function renderAttendanceTable\(records = null\) \{/;

const newBindFilters = `
  let analyticsCurrentPage = 1;
  let analyticsTotalPages = 1;
  let analyticsFilterTimeout = null;

  async function fetchAndRenderHistory(page = 1) {
    const searchInput = document.getElementById('analyticsSearch');
    const branchFilter = document.getElementById('analyticsFilterBranch');
    const yearFilter = document.getElementById('analyticsFilterYear');
    const sectionFilter = document.getElementById('analyticsFilterSection');
    const startDateFilter = document.getElementById('analyticsFilterStartDate');
    const endDateFilter = document.getElementById('analyticsFilterEndDate');
    const subjectFilter = document.getElementById('analyticsFilterSubject');
    const employeeFilter = document.getElementById('analyticsFilterEmployee');
    
    const query = new URLSearchParams({
       page: page,
       limit: 50
    });
    
    // Use the backend's ?query param ? No, the backend API I wrote didn't explicitly implement \`query\` string search for history yet, wait, let me check what I wrote for patch_history_api.js.
    // I didn't add \`query\` to patch_history_api.js. I should modify fetchAndRenderHistory to do that or just rely on what I have.
    // Let me just send what I have, and I'll add query search to the backend if needed, or I can rely on branch, year, section, subject, employee.
    
    if (branchFilter && branchFilter.value !== 'ALL') query.append('branch', branchFilter.value);
    if (yearFilter && yearFilter.value !== 'ALL') query.append('year', yearFilter.value);
    if (sectionFilter && sectionFilter.value !== 'ALL') query.append('section', sectionFilter.value);
    if (startDateFilter && startDateFilter.value) query.append('startDate', startDateFilter.value);
    if (endDateFilter && endDateFilter.value) query.append('endDate', endDateFilter.value);
    if (subjectFilter && subjectFilter.value) query.append('subject', subjectFilter.value);
    if (employeeFilter && employeeFilter.value) query.append('employee', employeeFilter.value);
    
    const tbody = document.getElementById('attendanceTableBody');
    const emptyState = document.getElementById('analyticsEmptyState');
    const tableContainer = tbody.closest('.table-container');
    
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';
    
    try {
      const res = await fetch('/api/attendance/history?' + query.toString(), {
         headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
      });
      const data = await res.json();
      
      if (data.success) {
         analyticsCurrentPage = data.pagination.page;
         analyticsTotalPages = data.pagination.totalPages;
         
         const pageStartEl = document.getElementById('pageStart');
         if(pageStartEl) pageStartEl.innerText = data.pagination.total === 0 ? 0 : ((analyticsCurrentPage - 1) * data.pagination.limit) + 1;
         
         const pageEndEl = document.getElementById('pageEnd');
         if(pageEndEl) pageEndEl.innerText = Math.min(analyticsCurrentPage * data.pagination.limit, data.pagination.total);
         
         const pageTotalEl = document.getElementById('pageTotal');
         if(pageTotalEl) pageTotalEl.innerText = data.pagination.total;
         
         const pageIndEl = document.getElementById('pageIndicator');
         if(pageIndEl) pageIndEl.innerText = \`Page \${analyticsCurrentPage} / \${Math.max(1, analyticsTotalPages)}\`;
         
         const btnPrev = document.getElementById('btnPagePrev');
         if(btnPrev) btnPrev.disabled = analyticsCurrentPage <= 1;
         
         const btnNext = document.getElementById('btnPageNext');
         if(btnNext) btnNext.disabled = analyticsCurrentPage >= analyticsTotalPages;
         
         if (data.data.length === 0) {
            tableContainer.style.display = 'none';
            if(emptyState) emptyState.style.display = 'block';
         } else {
            tableContainer.style.display = 'block';
            if(emptyState) emptyState.style.display = 'none';
            renderAttendanceTable(data.data);
         }
      }
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#ff4757;">Error loading history</td></tr>';
    }
  }

  function changeAnalyticsPage(delta) {
    const newPage = analyticsCurrentPage + delta;
    if (newPage >= 1 && newPage <= analyticsTotalPages) {
       fetchAndRenderHistory(newPage);
    }
  }

  function bindAnalyticsFilters() {
    const searchInput = document.getElementById('analyticsSearch');
    const branchFilter = document.getElementById('analyticsFilterBranch');
    const yearFilter = document.getElementById('analyticsFilterYear');
    const sectionFilter = document.getElementById('analyticsFilterSection');
    const startDateFilter = document.getElementById('analyticsFilterStartDate');
    const endDateFilter = document.getElementById('analyticsFilterEndDate');
    const subjectFilter = document.getElementById('analyticsFilterSubject');
    const employeeFilter = document.getElementById('analyticsFilterEmployee');

    const triggerFilter = () => {
      clearTimeout(analyticsFilterTimeout);
      analyticsFilterTimeout = setTimeout(() => {
         fetchAndRenderHistory(1);
      }, 300);
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
    if (sectionFilter) sectionFilter.addEventListener('change', triggerFilter);
    if (startDateFilter) startDateFilter.addEventListener('change', triggerFilter);
    if (endDateFilter) endDateFilter.addEventListener('change', triggerFilter);
    if (subjectFilter) subjectFilter.addEventListener('input', triggerFilter);
    if (employeeFilter) employeeFilter.addEventListener('input', triggerFilter);
  }

  function renderAttendanceTable(records = null) {`;

appjs = appjs.replace(oldBindFiltersRegex, newBindFilters);

// 2. Replace renderAttendanceTable contents
const oldRenderTableRegex = /function renderAttendanceTable\(records = null\) \{[\s\S]*?function bindModals\(\) \{/;

const newRenderTable = `function renderAttendanceTable(records = null) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!records) return; // Should be passed by fetchAndRenderHistory now

    const isAdmin = AuthManager.isAdmin();

    tbody.innerHTML = records.map((r, idx) => {
      const displaySubject = r.subject ? escapeHtml(r.subject) : 'General';
      const displayEmployee = r.sessionEmployee ? escapeHtml(r.sessionEmployee) : escapeHtml(r.markedBy);
      return \`
      <tr>
        <td class="text-subtle col-w-50">\${idx + 1 + ((analyticsCurrentPage - 1) * 50)}</td>
        <td class="font-mono font-semibold text-white">\${escapeHtml(r.rollNo)}</td>
        <td><strong>\${escapeHtml(r.name)}</strong></td>
        <td>\${r.section ? \`<span class="tag tag-section">Sec \${escapeHtml(r.section)}</span>\` : '<span class="text-subtle">-</span>'}</td>
        <td><span class="tag" style="background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.2);">\${displaySubject}</span></td>
        <td class="font-mono text-subtle">\${escapeHtml(r.date)}</td>
        <td><span style="color:#2ed573; font-weight:bold;">PRESENT</span></td>
        <td class="font-mono text-cyan">\${escapeHtml(r.timestamp)}</td>
        <td><span class="tag tag-session"><i class="fa-solid fa-user-tie"></i> \${displayEmployee}</span></td>
        <td class="text-right \${isAdmin ? '' : 'admin-only-el'}">
          \${isAdmin ? \`<button class="btn btn-danger btn-sm" onclick="App.deleteRecord('\${r.id}')" title="Delete record">
            <i class="fa-solid fa-trash"></i>
          </button>\` : ''}
        </td>
      </tr>
    \`;
    }).join('');

    // Hide clear logs button for non-admins
    const clearBtn = document.querySelector('[onclick="App.clearAttendanceLogs()"]');
    if (clearBtn) clearBtn.style.display = isAdmin ? '' : 'none';
  }

  function bindModals() {`;

appjs = appjs.replace(oldRenderTableRegex, newRenderTable);

// Add clearAnalyticsDateFilter override
appjs = appjs.replace(/function clearAnalyticsDateFilter\(\) \{[\s\S]*?\}/, `function clearAnalyticsDateFilter() {
    const sd = document.getElementById('analyticsFilterStartDate');
    const ed = document.getElementById('analyticsFilterEndDate');
    if (sd) sd.value = '';
    if (ed) ed.value = '';
    fetchAndRenderHistory(1);
  }`);

// Make sure changeAnalyticsPage and fetchAndRenderHistory are exposed
appjs = appjs.replace('updateAdminUI,', 'updateAdminUI,\n    changeAnalyticsPage,\n    fetchAndRenderHistory,');

// Override refreshAllViews to call fetchAndRenderHistory
appjs = appjs.replace(/function refreshAllViews\(\) \{[\s\S]*?\}/, `function refreshAllViews() {
    refreshKPIs();
    updateLiveTicker();
    if (document.getElementById('section-analytics').classList.contains('active')) {
      fetchAndRenderHistory(analyticsCurrentPage);
      AttendanceManager.renderCharts();
    }
  }`);

// Also trigger fetchAndRenderHistory when tab is clicked
appjs = appjs.replace("AttendanceManager.renderCharts();", "AttendanceManager.renderCharts();\n      fetchAndRenderHistory(1);");

fs.writeFileSync('js/app.js', appjs);
console.log('Patched app.js for history API');
