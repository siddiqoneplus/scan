/**
 * MAIN APPLICATION CONTROLLER
 * Coordinates tabs, modal dialogs, UI updates, live tickers,
 * employee student assignment, and quick-simulator test actions.
 */

const App = (() => {
  let activeTab = 'scanner';

  
  // --- COLD START WAKEUP ---
  async function ensureServerAwake() {
     const overlay = document.getElementById('coldStartOverlay');
     if (!overlay) return;
     
     const maxRetries = 30; // Wait up to 60 seconds (2s per try)
     let attempt = 0;
     
     while (attempt < maxRetries) {
       try {
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 2000);
         const res = await fetch('/api/health', { signal: controller.signal });
         clearTimeout(timeoutId);
         
         if (res.ok) {
           overlay.style.display = 'none';
           return;
         }
       } catch (e) {
         // Network error or timeout, server still booting
       }
       attempt++;
       await new Promise(r => setTimeout(r, 2000));
     }
     
     // Fallback if it completely fails, remove overlay so they can see standard errors
     overlay.style.display = 'none';
     showToast('Server seems offline. Check connection.', 'error');
  }


  function init() {
    ensureServerAwake();
    // Initialize auth
    AuthManager.init();

    // Auth guard: redirect to login if not authenticated
    if (!AuthManager.isLoggedIn()) {
      window.location.href = 'login.html';
      return;
    }

    // Initialize components
    EventManager.init();
    RosterManager.init();
    AttendanceManager.init();

    // Bind event listeners
    bindNavigation();
    bindRosterUI();
    bindAnalyticsUI();
    bindModals();
    bindSimulator();

    // Populate employee assignment selectors
    populateEmployeeDropdowns();

    // Apply role-based permissions
    applyRolePermissions();
    renderHeaderUserInfo();

    // Render event selector
    renderEventSelector();

    // Initial render
    refreshAllViews();

    // Auto-update roll number classification preview when adding student manually
    setupRollNumberInputListener();

    // Start scanner if on scanner tab
    setTimeout(() => {
      ScannerEngine.startCamera();
    }, 400);

    // Listen for roster updates
    window.addEventListener('roster:updated', () => {
      renderRosterTable();
      updateKPIs();
      renderSimulatorChips();
      QRStudio.renderStudentBadges();
      AttendanceManager.renderCharts();
      fetchAndRenderHistory(1);
    });

    // Listen for attendance updates
    window.addEventListener('attendance:updated', () => {
      updateKPIs();
      renderLiveTicker();
      renderAttendanceTable();
      AttendanceManager.renderCharts();
    });

    // Listen for event changes
    window.addEventListener('events:updated', () => {
      renderEventSelector();
    });

    window.addEventListener('events:switched', () => {
      renderEventSelector();
      refreshAllViews();
    });

    // Cross-tab real-time storage event synchronization
    window.addEventListener('storage', (e) => {
      try {
        if (e.key === 'smart_attendance_roster' || e.key === 'smart_attendance_roster_cleared') {
          if (typeof RosterManager.loadStudents === 'function') RosterManager.loadStudents();
          refreshAllViews();
        } else if (e.key === 'smart_attendance_logs' || e.key === 'smart_attendance_logs_cleared') {
          if (typeof AttendanceManager.loadLogs === 'function') AttendanceManager.loadLogs();
          refreshAllViews();
        }
      } catch (err) {
        console.warn('Cross-tab sync note:', err);
      }
    });

    // Background sync from server every 5 seconds to keep all employees & admins in sync
    setInterval(() => {
      RosterManager.syncFromServer();
      AttendanceManager.syncFromServer();
      EventManager.syncFromServer();
      checkDatabaseStatus();
    }, 5000);

    // Check MongoDB Atlas / Local database status
    checkDatabaseStatus();
  }

  /**
   * Populate employee accounts into assignment dropdowns
   */
  function populateEmployeeDropdowns() {
    const employees = AuthManager.getEmployeeAccounts();
    const selects = ['gformAssignTo', 'newStudentAssignedTo', 'editStudentAssignedTo', 'rosterFilterAssigned'];

    selects.forEach(selectId => {
      const el = document.getElementById(selectId);
      if (!el) return;

      const currentVal = el.value;
      if (selectId === 'rosterFilterAssigned') {
        el.innerHTML = `
          <option value="ALL">All Assignments</option>
          <option value="all">👥 All Employees (Shared)</option>
          ${employees.map(e => `<option value="${escapeHtml(e.username)}">👤 ${escapeHtml(e.displayName)} (${escapeHtml(e.username)})</option>`).join('')}
        `;
      } else {
        el.innerHTML = `
          <option value="all" selected>👥 All Employees (Default - Shared across all staff)</option>
          ${employees.map(e => `<option value="${escapeHtml(e.username)}">👤 ${escapeHtml(e.displayName)} (${escapeHtml(e.username)})</option>`).join('')}
        `;
      }
      if (currentVal && Array.from(el.options).some(o => o.value === currentVal)) {
        el.value = currentVal;
      }
    });
  }

  /**
   * Render user info in the header pill.
   */
  function renderHeaderUserInfo() {
    const session = AuthManager.getSession();
    if (!session) return;

    const nameEl = document.getElementById('headerUserName');
    const roleEl = document.getElementById('headerUserRole');
    const avatarEl = document.getElementById('userAvatar');

    if (nameEl) nameEl.textContent = session.displayName || session.username;
    if (roleEl) {
      roleEl.textContent = session.role === 'admin' ? 'Admin' : 'Employee';
      roleEl.className = 'user-role-badge ' + (session.role === 'admin' ? 'role-admin' : 'role-employee');
    }
    if (avatarEl) {
      avatarEl.innerHTML = session.role === 'admin'
        ? '<i class="fa-solid fa-shield-halved"></i>'
        : '<i class="fa-solid fa-user-tie"></i>';
    }
  }

  /**
   * Apply role-based visibility and access control.
   */
  function applyRolePermissions() {
    const isAdmin = AuthManager.isAdmin();

    // Roster tab is available to both Admin and Employee
    const rosterTab = document.getElementById('tabBtnRoster');
    const rosterLabel = document.getElementById('tabBtnRosterLabel');
    if (rosterTab) rosterTab.style.display = '';
    if (rosterLabel) {
      rosterLabel.textContent = isAdmin ? 'Admin & Google Form' : 'Assigned Roster';
    }

    // QR Cards Studio is Admin-only
    const cardsTab = document.getElementById('tabBtnCards');
    if (cardsTab) cardsTab.style.display = isAdmin ? '' : 'none';

    // Admin-only elements (manage accounts button, add/import/clear buttons, rules)
    document.querySelectorAll('.admin-only-el').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    // Employee restrictions: hide simulator bar
    const simBar = document.querySelector('.quick-simulator-bar');
    if (simBar) simBar.style.display = isAdmin ? '' : 'none';
  }

  /**
   * Handle user logout.
   */
  function handleLogout() {
    if (confirm('Are you sure you want to sign out?')) {
      AuthManager.logout();
      window.location.href = 'login.html';
    }
  }

  function bindNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });
  }

  
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
            
            tr.innerHTML = `
              <td><strong>${escapeHtml(s.subject)}</strong></td>
              <td>${escapeHtml(s.period)}</td>
              <td><span class="tag tag-section">Sec ${escapeHtml(s.section)}</span></td>
              <td><i class="fa-solid fa-user-tie" style="color:#a4b0be;"></i> ${escapeHtml(s.employee)}</td>
              <td><strong>${s.presentCount}</strong> / ${s.totalCount}</td>
              <td><span style="color: ${statusColor}; font-weight:bold;">${statusLabel}</span></td>
            `;
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


  function switchTab(tabId) {
    activeTab = tabId;

    // Update active nav button
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update tab sections
    document.querySelectorAll('.tab-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const targetSection = document.getElementById(`section-${tabId}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    // Tab-specific lifecycle hooks
    if (tabId === 'scanner') {
      ScannerEngine.startCamera();
    } else {
      ScannerEngine.stopCamera();
    }

    if (tabId === 'cards') {
      QRStudio.renderStudentBadges();
    } else if (tabId === 'analytics') {
      renderAttendanceTable();
      setTimeout(() => {
        AttendanceManager.renderCharts();
      }, 100);
    } else if (tabId === 'roster') {
      renderRosterTable();
    }
  }

  function refreshAllViews() {
    refreshKPIs();
    updateLiveTicker();
    if (document.getElementById('section-analytics').classList.contains('active')) {
      fetchAndRenderHistory(analyticsCurrentPage);
      AttendanceManager.renderCharts();
    }
  }

  function updateKPIs() {
    const metrics = AttendanceManager.getMetrics();
    
    const elReg = document.getElementById('kpiTotalRegistered');
    const elPres = document.getElementById('kpiTotalPresent');
    const elRate = document.getElementById('kpiAttendanceRate');
    const elScans = document.getElementById('kpiTotalScans');

    if (elReg) elReg.textContent = metrics.totalRegistered;
    if (elPres) elPres.textContent = metrics.totalPresentToday;
    if (elRate) elRate.textContent = `${metrics.attendanceRate}%`;
    if (elScans) elScans.textContent = metrics.totalScansToday;

    // Update KPI subtitles with event context
    const activeEvent = EventManager.getActiveEvent();
    const kpiRegSub = document.getElementById('kpiRegSub');
    const kpiPresSub = document.getElementById('kpiPresSub');
    if (kpiRegSub) kpiRegSub.textContent = activeEvent ? `For: ${activeEvent.name}` : 'Admin Whitelisted';
    if (kpiPresSub) kpiPresSub.textContent = activeEvent ? `Event check-ins` : 'Unique check-ins';
  }

  function renderLiveTicker() {
    const ticker = document.getElementById('liveTicker');
    if (!ticker) return;

    const logs = AttendanceManager.getAllLogs().slice(0, 15);
    if (logs.length === 0) {
      ticker.innerHTML = `
        <div class="empty-placeholder">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <p>No scans recorded yet today.</p>
        </div>
      `;
      return;
    }

    ticker.innerHTML = logs.map(r => `
      <div class="ticker-item">
        <div class="ticker-left">
          <span class="ticker-dot"></span>
          <div>
            <div class="ticker-roll">${escapeHtml(r.rollNo)}</div>
            <div class="ticker-name">${escapeHtml(r.name)} • ${escapeHtml(r.branch.split('(')[1]?.replace(')', '') || r.branch)}</div>
          </div>
        </div>
        <div class="ticker-time">${escapeHtml(r.timestamp)}</div>
      </div>
    `).join('');
  }

  function renderSimulatorChips() {
    const container = document.getElementById('simulatorChips');
    if (!container) return;

    const students = RosterManager.getAllStudents().slice(0, 7);
    if (students.length === 0) {
      container.innerHTML = `
        <span class="text-subtle text-sm" style="font-style: italic; opacity: 0.75; padding: 0.25rem 0.5rem;">
          No students in whitelist yet. Add students or import a CSV in the Roster tab to enable quick test scans.
        </span>
      `;
      return;
    }

    let html = students.map(s => {
      const branchAbbr = s.branch.split('(')[1]?.replace(')', '') || s.branch.split(' ')[0];
      return `
        <button class="sim-chip" onclick="App.simulateScan('${s.rollNo}')" title="Click to test scan ${s.name} (${s.branch})">
          <i class="fa-solid fa-qrcode"></i> <strong>${escapeHtml(s.rollNo)}</strong> <span class="sim-chip-tag">${escapeHtml(branchAbbr)}</span>
        </button>
      `;
    }).join('');

    html += `
      <button class="sim-chip invalid" onclick="App.simulateScan('99ZZ9A9999')" title="Simulate unassigned/invalid roll number">
        <i class="fa-solid fa-ban"></i> 99ZZ9A9999 (Unassigned)
      </button>
    `;

    container.innerHTML = html;
  }

  async function simulateScan(rollNo) {
    if (activeTab !== 'scanner') {
      switchTab('scanner');
    }
    
    // For simulation, we want to test the actual secure QR pipeline
    try {
      const res = await fetch('/api/roster/qr-tokens');
      const data = await res.json();
      if (data.success && data.tokens[rollNo]) {
        // Mock the camera success handler passing the secure JWT
        if (typeof ScannerEngine.handleScanSuccess === 'function') {
           ScannerEngine.handleScanSuccess(data.tokens[rollNo]);
        } else {
           // Direct call to processSecureScan if handleScanSuccess isn't exported
           ScannerEngine.processSecureScan(data.tokens[rollNo]);
        }
        return;
      }
    } catch (e) {}

    // Fallback if not admin or token fetch fails
    ScannerEngine.processRollNumber(rollNo);
  }

  function handleManualSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('manualRollInput');
    if (!input || !input.value.trim()) return;

    const roll = input.value.trim();
    ScannerEngine.processRollNumber(roll);
    input.value = '';
  }

  function setupRollNumberInputListener() {
    const input = document.getElementById('newStudentRoll');
    const branchInput = document.getElementById('newStudentBranch');
    const yearInput = document.getElementById('newStudentYear');
    const hint = document.getElementById('autoClassificationHint');

    if (!input || !branchInput || !yearInput) return;

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val.length >= 4) {
        if (hint) hint.style.display = 'none';
      } else {
        if (hint) hint.style.display = 'none';
      }
    });
  }

  function bindRosterUI() {
    const searchInput = document.getElementById('rosterSearch');
    const branchFilter = document.getElementById('rosterFilterBranch');
    const yearFilter = document.getElementById('rosterFilterYear');
    const assignedFilter = document.getElementById('rosterFilterAssigned');
    const sectionFilter = document.getElementById('rosterFilterSection');

    const triggerFilter = () => {
      renderRosterTable(
        searchInput ? searchInput.value : '',
        branchFilter ? branchFilter.value : 'ALL',
        yearFilter ? yearFilter.value : 'ALL',
        assignedFilter ? assignedFilter.value : 'ALL',
        sectionFilter ? sectionFilter.value : 'ALL'
      );
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
    if (assignedFilter) assignedFilter.addEventListener('change', triggerFilter);
    if (sectionFilter) sectionFilter.addEventListener('change', triggerFilter);
  }

  function renderRosterTable(query = null, branch = null, year = null, assigned = null, section = null) {
    const tbody = document.getElementById('rosterTableBody');
    if (!tbody) return;

    const q = (query !== null ? query : (document.getElementById('rosterSearch')?.value || '')).toLowerCase().trim();
    const b = branch !== null ? branch : (document.getElementById('rosterFilterBranch')?.value || 'ALL');
    const y = year !== null ? year : (document.getElementById('rosterFilterYear')?.value || 'ALL');
    const a = assigned !== null ? assigned : (document.getElementById('rosterFilterAssigned')?.value || 'ALL');
    const sec = section !== null ? section : (document.getElementById('rosterFilterSection')?.value || 'ALL');

    const session = AuthManager.getSession();
    const isAdmin = AuthManager.isAdmin();

    // Roster is filtered by user permissions: Admin sees all; Employee sees assigned students
    let students = RosterManager.getStudentsForUser(session ? session.username : null, session ? session.role : null);

    students = students.filter(s => {
      if (b !== 'ALL' && s.branch !== b && !s.branch.includes(b) && !b.includes(s.branch)) return false;
      if (y !== 'ALL' && s.year !== y && !s.year.includes(y) && !y.includes(s.year)) return false;
      if (a !== 'ALL' && (s.assignedTo || 'all').toLowerCase() !== a.toLowerCase()) return false;
      if (sec !== 'ALL' && (s.section || '').toUpperCase() !== sec.toUpperCase()) return false;
      if (q && !s.rollNo.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-placeholder" style="padding: 2.5rem 1rem; text-align: center;">
            <i class="fa-solid fa-folder-open" style="font-size: 2rem; opacity: 0.35; display: block; margin-bottom: 0.6rem;"></i>
            No student records found in whitelist. Use <strong>"Add Student"</strong> or <strong>"Import CSV"</strong> above to register students.
          </td>
        </tr>
      `;
      return;
    }

    const today = AttendanceManager.getTodayDateStr();
    const activeSession = 'Attendance';

    tbody.innerHTML = students.map((s, idx) => {
      const isPresent = AttendanceManager.isAlreadyMarked(s.rollNo, activeSession);
      const isSharedAll = !s.assignedTo || s.assignedTo === 'all';
      const sectionLabel = s.section ? s.section : '—';
      return `
        <tr>
          <td class="text-subtle col-w-50">${idx + 1}</td>
          <td class="font-mono font-semibold text-white">${escapeHtml(s.rollNo)}</td>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td><span class="tag tag-branch">${escapeHtml(s.branch)}</span></td>
          <td><span class="tag tag-section">${escapeHtml(sectionLabel)}</span></td>
          <td><span class="tag tag-year">${escapeHtml(s.year)}</span></td>
          <td>
            ${isSharedAll 
              ? `<span class="tag tag-assigned-all"><i class="fa-solid fa-users"></i> All Employees</span>` 
              : `<span class="tag tag-session"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(s.assignedTo)}</span>`}
          </td>
          <td>
            ${isPresent 
              ? `<span class="tag tag-present"><i class="fa-solid fa-check"></i> Present</span>` 
              : `<span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> Absent</span>`}
          </td>
          <td class="text-right ${isAdmin ? '' : 'admin-only-el'}">
            <div class="row-action-btns">
              ${isAdmin ? `
                ${isPresent 
                  ? `<button class="btn btn-secondary btn-sm" onclick="App.toggleStudentAttendance('${s.rollNo}')" title="Mark Absent for this session">
                      <i class="fa-solid fa-user-xmark"></i>
                    </button>` 
                  : `<button class="btn btn-primary btn-sm" onclick="App.toggleStudentAttendance('${s.rollNo}')" title="Mark Present immediately">
                      <i class="fa-solid fa-user-check"></i>
                    </button>`
                }
              ` : ''}
              <button class="btn btn-secondary btn-sm" onclick="App.openViewQR('${s.rollNo}')" title="View QR Card">
                <i class="fa-solid fa-id-card"></i>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="App.simulateScan('${s.rollNo}')" title="Test QR Scan">
                <i class="fa-solid fa-barcode"></i>
              </button>
              ${isAdmin ? `
                <button class="btn btn-secondary btn-sm" onclick="App.openEditStudentModal('${s.rollNo}')" title="Edit Student Profile">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteStudent('${s.rollNo}')" title="Delete Student">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function bindAnalyticsUI() {
    const searchInput = document.getElementById('analyticsSearch');
    const branchFilter = document.getElementById('analyticsFilterBranch');
    const yearFilter = document.getElementById('analyticsFilterYear');
    const sectionFilter = document.getElementById('analyticsFilterSection');
    const dateFilter = document.getElementById('analyticsFilterDate');

    const triggerFilter = () => {
      const filtered = AttendanceManager.getFilteredLogs({
        query: searchInput ? searchInput.value : '',
        branch: branchFilter ? branchFilter.value : 'ALL',
        year: yearFilter ? yearFilter.value : 'ALL',
        section: sectionFilter ? sectionFilter.value : 'ALL',
        date: dateFilter ? dateFilter.value : ''
      });
      renderAttendanceTable(filtered);
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
    if (sectionFilter) sectionFilter.addEventListener('change', triggerFilter);
    if (dateFilter) dateFilter.addEventListener('change', triggerFilter);
  }

  function renderAttendanceTable(records = null) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!records) return; // Should be passed by fetchAndRenderHistory now

    const isAdmin = AuthManager.isAdmin();

    tbody.innerHTML = records.map((r, idx) => {
      const displaySubject = r.subject ? escapeHtml(r.subject) : 'General';
      const displayEmployee = r.sessionEmployee ? escapeHtml(r.sessionEmployee) : escapeHtml(r.markedBy);
      return `
      <tr>
        <td class="text-subtle col-w-50">${idx + 1 + ((analyticsCurrentPage - 1) * 50)}</td>
        <td class="font-mono font-semibold text-white">${escapeHtml(r.rollNo)}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${r.section ? `<span class="tag tag-section">Sec ${escapeHtml(r.section)}</span>` : '<span class="text-subtle">-</span>'}</td>
        <td><span class="tag" style="background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.2);">${displaySubject}</span></td>
        <td class="font-mono text-subtle">${escapeHtml(r.date)}</td>
        <td><span style="color:#2ed573; font-weight:bold;">PRESENT</span></td>
        <td class="font-mono text-cyan">${escapeHtml(r.timestamp)}</td>
        <td><span class="tag tag-session"><i class="fa-solid fa-user-tie"></i> ${displayEmployee}</span></td>
        <td class="text-right ${isAdmin ? '' : 'admin-only-el'}">
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="App.deleteRecord('${r.id}')" title="Delete record">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </td>
      </tr>
    `;
    }).join('');

    // Hide clear logs button for non-admins
    const clearBtn = document.querySelector('[onclick="App.clearAttendanceLogs()"]');
    if (clearBtn) clearBtn.style.display = isAdmin ? '' : 'none';
  }

  
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
          
          document.getElementById('auditPageIndicator').innerText = `Page ${auditCurrentPage} of ${Math.max(1, auditTotalPages)} (Total: ${data.pagination.total})`;
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
                
                return `
                  <tr>
                    <td style="font-family:monospace; color:#a4b0be; white-space:nowrap;">${date}</td>
                    <td><strong style="color:white;">${escapeHtml(log.actor)}</strong></td>
                    <td><span class="tag tag-branch" style="padding:2px 6px; font-size:0.75rem;">${escapeHtml(log.role)}</span></td>
                    <td><span style="color:${actionColor}; font-weight:bold; text-transform:uppercase; font-size:0.8rem;">${escapeHtml(log.action)}</span></td>
                    <td style="font-family:monospace; color:var(--text-main);">${escapeHtml(log.resource)}</td>
                    <td style="font-size:0.8rem; color:#a4b0be; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title='${escapeHtml(metaStr)}'>${escapeHtml(metaStr)}</td>
                  </tr>
                `;
             }).join('');
          }
       } else {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ff4757;">${escapeHtml(data.error || 'Failed to load logs')}</td></tr>`;
       }
    } catch (e) {
       tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ff4757;">Network error.</td></tr>';
    }
  }

  function bindModals() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    });
  }

  function openModal(modalId) {
    document.body.classList.add("modal-open");
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      if (modalId === 'modalManageAccounts') {
        renderAccountsTable();
      }
      if (modalId === 'modalGoogleForm' || modalId === 'modalAddStudent') {
        populateEmployeeDropdowns();
      }
      if (modalId === 'modalExportPresent') {
        const todaySpan = document.getElementById('modalExportTodayDate');
        if (todaySpan) todaySpan.textContent = AttendanceManager.getTodayDateStr();
      }
    }
  }

  function closeModal(modalId) {
    document.body.classList.remove("modal-open");
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

    async function submitAddStudent(e) {
    if (e) e.preventDefault();
    const btn = e ? e.submitter : null;
    App.setBtnLoading(btn, true, 'Saving...');
    
    const rollNo = document.getElementById('newStudentRoll')?.value;
    const name = document.getElementById('newStudentName')?.value;
    const branch = document.getElementById('newStudentBranch')?.value;
    const year = document.getElementById('newStudentYear')?.value;
    const section = document.getElementById('newStudentSection')?.value || '';
    const assignedTo = document.getElementById('newStudentAssignedTo')?.value || 'all';

    try {
      // Instead of relying purely on RosterManager local push, do the API call
      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') },
        body: JSON.stringify([{ rollNo, name, branch, year, section, assignedTo }])
      });
      const data = await res.json();
      App.setBtnLoading(btn, false);
      
      if (data.success) {
        closeModal('modalAddStudent');
        const assignLabel = assignedTo === 'all' ? 'All Employees' : assignedTo;
        showToast(`Student ${rollNo} registered & assigned to ${assignLabel}!`, 'success');
        document.getElementById('formAddStudent').reset();
        fetchAndRenderRoster(1);
      } else {
        showToast(data.error || 'Failed to add student', 'error');
      }
    } catch (err) {
      App.setBtnLoading(btn, false);
      showToast(err.message || 'Network Error', 'error');
    }
  }

  async function submitImportGoogleForm() {
    const csvContent = document.getElementById('gformCsvInput')?.value;
    const assignedTo = document.getElementById('gformAssignTo')?.value || 'all';

    if (!csvContent || !csvContent.trim()) {
      showToast('Please paste Google Form CSV responses or upload a CSV file.', 'warning');
      return;
    }

    try {
      const summary = await RosterManager.importGoogleFormCSV(csvContent, assignedTo);
      closeModal('modalGoogleForm');
      document.getElementById('gformCsvInput').value = '';
      refreshAllViews();

      let msg = `Import Complete:\nTotal Rows: ${summary.totalRows}\nSuccessfully Imported: ${summary.importedCount}\nDuplicates Skipped: ${summary.duplicates}\nInvalid Rows: ${summary.invalidRows}`;
      
      if (summary.errors && summary.errors.length > 0) {
        msg += '\n\nThere were errors. Downloading error log...';
        showToast(msg, 'warning');
        
        // Trigger download of error log
        const errorBlob = new Blob([summary.errors.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(errorBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `import_errors_${new Date().getTime()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        showToast(msg, 'success');
      }

    } catch (err) {
      showToast('Import Error: ' + err.message, 'error');
    }
  }

  function loadSampleGoogleFormTemplate() {
    const sampleCsv = `Timestamp,Student Name,Roll Number,Branch,Academic Year
2026/09/01 10:15:30 AM,Kunal Sen,24A81A4401,Data Science,3rd Year
2026/09/01 10:16:45 AM,Aditi Rao,24A81A6101,AIML,3rd Year
2026/09/01 10:17:12 AM,Suresh Babu,24A81A4301,CAI,3rd Year
2026/09/01 10:18:05 AM,Harini Murugan,26A81A4403,Data Science,1st Year
2026/09/01 10:19:22 AM,Abhinav Sharma,25A81A6102,AIML,2nd Year`;

    const textarea = document.getElementById('gformCsvInput');
    if (textarea) {
      textarea.value = sampleCsv;
      showToast('Sample Google Form response data loaded. Click Process Import!', 'info');
    }
  }

  function openEditStudentModal(rollNo) {
    const student = RosterManager.findStudent(rollNo);
    if (!student) {
      showToast('Student not found.', 'error');
      return;
    }
    populateEmployeeDropdowns();
    const rollInput = document.getElementById('editStudentRoll');
    const nameInput = document.getElementById('editStudentName');
    const branchInput = document.getElementById('editStudentBranch');
    const yearInput = document.getElementById('editStudentYear');
    const sectionInput = document.getElementById('editStudentSection');
    const assignedInput = document.getElementById('editStudentAssignedTo');

    if (rollInput) rollInput.value = student.rollNo;
    if (nameInput) nameInput.value = student.name;
    if (branchInput) branchInput.value = student.branch;
    if (yearInput) yearInput.value = student.year;
    if (sectionInput) sectionInput.value = student.section || '';
    if (assignedInput) assignedInput.value = student.assignedTo || 'all';

    openModal('modalEditStudent');
  }

    async function submitEditStudent(e) {
    if (e) e.preventDefault();
    const btn = e ? e.submitter : null;
    App.setBtnLoading(btn, true, 'Saving...');
    
    const rollNo = document.getElementById('editStudentRoll')?.value;
    const name = document.getElementById('editStudentName')?.value;
    const branch = document.getElementById('editStudentBranch')?.value;
    const year = document.getElementById('editStudentYear')?.value;
    const section = document.getElementById('editStudentSection')?.value || '';
    const assignedTo = document.getElementById('editStudentAssignedTo')?.value || 'all';

    try {
      const res = await fetch('/api/roster/student', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') },
        body: JSON.stringify({ rollNo, action: 'edit', updates: { name, branch, year, section, assignedTo } })
      });
      const data = await res.json();
      App.setBtnLoading(btn, false);
      
      if (data.success) {
        closeModal('modalEditStudent');
        showToast(`Student ${rollNo} updated!`, 'success');
        fetchAndRenderRoster(rosterCurrentPage);
      } else {
        showToast(data.error || 'Failed to update student', 'error');
      }
    } catch (err) {
      App.setBtnLoading(btn, false);
      showToast(err.message || 'Network Error', 'error');
    }
  }

  function toggleStudentAttendance(rollNo) {
    const activeSession = 'Attendance';
    if (AttendanceManager.isAlreadyMarked(rollNo, activeSession)) {
      AttendanceManager.removeAttendanceForStudent(rollNo, activeSession);
      showToast(`Marked Absent: ${rollNo}`, 'info');
    } else {
      const student = RosterManager.findStudent(rollNo);
      if (student) {
        AttendanceManager.recordAttendance(student, activeSession);
        showToast(`Marked Present: ${student.name}`, 'success');
      }
    }
    refreshAllViews();
  }

  function exportRosterCSV() {
    try {
      RosterManager.exportCSV();
      showToast('Student whitelist exported as CSV!', 'success');
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  function confirmClearAllStudents() {
    openModal('modalClearWhitelist');
  }

  async function executePermanentClear() {
    closeModal('modalClearWhitelist');

    try {
      showToast('Permanently erasing whitelist and clearing all attendance data...', 'info');

      // 1. Call dedicated atomic backend purge to wipe MongoDB Atlas and local JSON files
      try {
        await fetch('/api/admin/clear-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        console.warn('Backend clear-all endpoint note:', e);
      }

      // 2. Clear students roster locally & on server
      await RosterManager.clearAll();

      // 3. Clear attendance logs locally & on server
      await AttendanceManager.clearAllLogs();

      // 4. Reset scan result banner
      const banner = document.getElementById('scanResultBanner');
      if (banner) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        banner.className = 'result-banner';
      }

      // 5. Force update all KPI cards and views to 0
      refreshAllViews();

      showToast('Complete data permanently erased: Registered Students, Present Today, Attendance Rate, and Total Scans have been reset to 0.', 'success');
    } catch (err) {
      console.error('Error clearing data:', err);
      showToast('Error during clear: ' + err.message, 'error');
      refreshAllViews();
    }
  }

  // Backwards compatibility alias
  async function clearAllStudents() {
    confirmClearAllStudents();
  }

  function handleGoogleFormFileUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const textarea = document.getElementById('gformCsvInput');
      if (textarea) {
        textarea.value = text;
        showToast(`Loaded ${file.name} (${text.split(/\r\n|\n|\r/).length} lines). Ready to process!`, 'info');
      }
    };
    reader.readAsText(file);
  }

  function openBranchRulesModal() {
    renderBranchRulesTable();
    openModal('modalBranchRules');
  }

  function renderBranchRulesTable() {
    const tbody = document.getElementById('branchRulesTableBody');
    if (!tbody) return;
    const rules = RosterManager.getBranchRules();
    const entries = Object.entries(rules);
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-placeholder">No branch rules defined.</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map(([code, name]) => `
      <tr>
        <td class="font-mono font-semibold text-cyan">${escapeHtml(code)}</td>
        <td><strong>${escapeHtml(name)}</strong></td>
        <td class="text-right">
          <button class="btn btn-danger btn-sm" onclick="App.deleteBranchRuleEntry('${escapeHtml(code)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  function submitAddBranchRule(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('newRuleCode')?.value;
    const name = document.getElementById('newRuleName')?.value;
    try {
      RosterManager.setBranchRule(code, name);
      document.getElementById('formAddBranchRule')?.reset();
      renderBranchRulesTable();
      showToast(`Branch rule ${code} -> ${name} saved!`, 'success');
      refreshAllViews();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function deleteBranchRuleEntry(code) {
    if (confirm(`Delete branch mapping for code "${code}"?`)) {
      RosterManager.deleteBranchRule(code);
      renderBranchRulesTable();
      showToast(`Deleted rule "${code}"`, 'info');
      refreshAllViews();
    }
  }

  function clearAnalyticsDateFilter() {
    const sd = document.getElementById('analyticsFilterStartDate');
    const ed = document.getElementById('analyticsFilterEndDate');
    if (sd) sd.value = '';
    if (ed) ed.value = '';
    fetchAndRenderHistory(1);
  }

  function deleteStudent(rollNo) {
    if (confirm(`Are you sure you want to remove Roll Number ${rollNo} from the Admin whitelist?`)) {
      RosterManager.deleteStudent(rollNo);
      showToast(`Removed student ${rollNo}`, 'info');
    }
  }

  function deleteRecord(recordId) {
    AttendanceManager.deleteRecord(recordId);
    showToast('Attendance record deleted', 'info');
  }

  function resetRosterToDefault() {
    clearAllStudents();
  }

  async function clearAttendanceLogs() {
    if (confirm('Clear all recorded attendance logs for today? This will reset Present Today, Attendance Rate, and Total Scans Logged to 0.')) {
      await AttendanceManager.clearAllLogs();
      const banner = document.getElementById('scanResultBanner');
      if (banner) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        banner.className = 'result-banner';
      }
      refreshAllViews();
      showToast('Attendance logs cleared. Today metrics reset to 0.', 'info');
    }
  }

  
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

  async 

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
      showToast(`Exported ${records.length} attendance records as CSV!`, 'success');
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
      showToast(`Downloaded PDF report (${records.length} records)!`, 'success');
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
        dateStr: `${AttendanceManager.getTodayDateStr()} (Today)`,
        sessionName: 'Daily Check-ins',
        filterDesc: 'Today Check-ins (Unique Students)',
        uniqueOnly: true,
        includeSummary: true
      });
      showToast(`Downloaded PDF for ${uniqueRecords.length} present students!`, 'success');
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
        AttendanceManager.exportCSV(finalRecords, { uniqueOnly, filename: `Export_${scope}_${Date.now()}.csv` });
      } else if (format === 'print') {
        AttendanceManager.exportPDF(finalRecords, { title, dateStr, sessionName: 'Attendance', filterDesc, includeSummary });
        // The pdf library opens print dialog if print options are passed, 
        // for now just generating PDF since we don't have a native HTML print format for 10k rows
      } else {
        AttendanceManager.exportPDF(finalRecords, { title, dateStr, sessionName: 'Attendance', filterDesc, includeSummary });
      }

      closeModal('modalExportPresent');
      showToast(`Official Report exported (${finalRecords.length} records).`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }




  function bindSimulator() {
    // Quick simulator chip listeners handled inline or via delegate
  }

  // --- UI Loader State Manager ---
  function setBtnLoading(btnElement, isLoading, loadingText = 'Loading...') {
     if (!btnElement) return;
     if (isLoading) {
        if(btnElement.disabled && !btnElement.dataset.originalText) return; // already loading
        btnElement.disabled = true;
        btnElement.dataset.originalText = btnElement.innerHTML;
        btnElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
     } else {
        btnElement.disabled = false;
        if (btnElement.dataset.originalText) {
            btnElement.innerHTML = btnElement.dataset.originalText;
            delete btnElement.dataset.originalText;
        }
     }
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${icon}"></i>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  /**
   * Submit new account from the Manage Accounts modal.
   */
  function submitAddAccount(e) {
    if (e) e.preventDefault();
    const username = document.getElementById('newAccUsername')?.value;
    const password = document.getElementById('newAccPassword')?.value;
    const displayName = document.getElementById('newAccDisplayName')?.value;
    const role = document.getElementById('newAccRole')?.value || 'employee';

    try {
      AuthManager.addAccount({ username, password, displayName, role });
      showToast(`Account "${username}" created successfully!`, 'success');
      document.getElementById('formAddAccount').reset();
      renderAccountsTable();
      populateEmployeeDropdowns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * Delete an account from the Manage Accounts modal.
   */
  function deleteAccountEntry(username) {
    if (confirm(`Delete account "${username}"? This cannot be undone.`)) {
      try {
        AuthManager.deleteAccount(username);
        showToast(`Account "${username}" deleted.`, 'info');
        renderAccountsTable();
        populateEmployeeDropdowns();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }

  /**
   * Render the accounts table inside the Manage Accounts modal.
   */
  function renderAccountsTable() {
    const tbody = document.getElementById('accountsTableBody');
    if (!tbody) return;

    const accounts = AuthManager.listAccounts();
    const currentUser = AuthManager.getSession()?.username;

    tbody.innerHTML = accounts.map((a, idx) => `
      <tr>
        <td class="text-subtle col-w-50">${idx + 1}</td>
        <td class="font-mono font-semibold text-white">${escapeHtml(a.username)}</td>
        <td>${escapeHtml(a.displayName)}</td>
        <td><span class="tag ${a.role === 'admin' ? 'tag-present' : 'tag-session'}">${a.role === 'admin' ? 'Admin' : 'Employee'}</span></td>
        <td class="text-right">
          ${a.username.toLowerCase() === currentUser?.toLowerCase()
            ? '<span class="tag tag-year">You</span>'
            : `<button class="btn btn-danger btn-sm" onclick="App.deleteAccountEntry('${a.username}')" title="Delete account">
                <i class="fa-solid fa-trash"></i>
              </button>`}
        </td>
      </tr>
    `).join('');
  }

  /**
   * Fetch and update the MongoDB Atlas / Local Storage connection badge
   */
  async function checkDatabaseStatus() {
    try {
      const res = await fetch('/api/db/status');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.db) return;

      const dot = document.getElementById('dbStatusDot');
      const text = document.getElementById('dbStatusText');
      const pill = document.getElementById('dbStatusPill');

      if (data.db.connected) {
        if (dot) dot.className = 'db-status-dot atlas';
        if (text) text.textContent = 'MongoDB Atlas';
        if (pill) pill.title = `Connected to MongoDB Atlas (${data.db.dbName}) • Click to configure`;
      } else if (data.db.uriConfigured) {
        if (dot) dot.className = 'db-status-dot error';
        if (text) text.textContent = 'Atlas Error';
        if (pill) pill.title = `MongoDB Atlas error: ${data.db.lastError} • Click to configure`;
      } else {
        if (dot) dot.className = 'db-status-dot local';
        if (text) text.textContent = 'Local Storage';
        if (pill) pill.title = `Running on Local Storage (Click to connect MongoDB Atlas)`;
      }

      renderDatabaseModalBanner(data.db);
    } catch (e) {
      // Offline fallback
    }
  }

  function renderDatabaseModalBanner(dbStatus) {
    const banner = document.getElementById('dbStatusBanner');
    const title = document.getElementById('dbStatusTitle');
    const badge = document.getElementById('dbModeBadge');
    const detail = document.getElementById('dbStatusDetail');

    if (!banner || !title || !badge || !detail) return;

    if (dbStatus.connected) {
      banner.className = 'db-status-banner atlas';
      title.textContent = `Connected to MongoDB Atlas Cloud`;
      badge.textContent = 'ATLAS ACTIVE';
      badge.className = 'tag tag-present';
      detail.textContent = `Cluster database "${dbStatus.dbName}" is active. Total: ${dbStatus.counts.students} students, ${dbStatus.counts.attendance} attendance records.`;
    } else {
      banner.className = 'db-status-banner';
      title.textContent = dbStatus.uriConfigured ? 'Connection Failed (Using Local Storage)' : 'Local JSON Storage Active';
      badge.textContent = 'LOCAL MODE';
      badge.className = 'tag tag-session';
      detail.textContent = dbStatus.uriConfigured
        ? `Error connecting to Atlas: ${dbStatus.lastError || 'Unreachable'}. App is safely using local files.`
        : 'App is currently persisting data to local files in ./data. Connect MongoDB Atlas to sync across devices.';
    }
  }

  function openDatabaseModal() {
    openModal('modalDatabase');
    checkDatabaseStatus();
  }

  function toggleDbUriVisibility() {
    const input = document.getElementById('inputMongoUri');
    const icon = document.getElementById('toggleUriIcon');
    if (!input || !icon) return;
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'fa-solid fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'fa-solid fa-eye';
    }
  }

  async function testDatabaseConnection() {
    const input = document.getElementById('inputMongoUri');
    const feedback = document.getElementById('dbTestFeedback');
    const uri = input?.value?.trim();

    if (!uri) {
      showToast('Please enter a MongoDB connection URI to test.', 'warning');
      return;
    }

    if (feedback) {
      feedback.className = 'db-test-feedback';
      feedback.style.display = 'block';
      feedback.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing connection to MongoDB Atlas...';
    }

    try {
      const res = await fetch('/api/db/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri })
      });
      const data = await res.json();

      if (data.success) {
        feedback.className = 'db-test-feedback success';
        feedback.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(data.message || 'Connection successful!')}`;
        showToast('MongoDB Atlas connection verified!', 'success');
      } else {
        feedback.className = 'db-test-feedback error';
        feedback.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Connection Failed: ${escapeHtml(data.error || 'Check username, password, and IP whitelist.')}`;
        showToast('MongoDB connection failed. See details.', 'error');
      }
    } catch (e) {
      if (feedback) {
        feedback.className = 'db-test-feedback error';
        feedback.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Network test error: ${escapeHtml(e.message)}`;
      }
    }
  }

  async function submitDatabaseConfig(event) {
    if (event) event.preventDefault();
    const uri = document.getElementById('inputMongoUri')?.value?.trim();
    const dbName = document.getElementById('inputDbName')?.value?.trim() || 'smart_attendance';

    if (!uri) {
      showToast('MongoDB URI string is required.', 'warning');
      return;
    }

    showToast('Connecting to MongoDB Atlas...', 'info');

    try {
      const res = await fetch('/api/db/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, dbName })
      });
      const data = await res.json();

      if (data.success && data.db.connected) {
        showToast('Connected to MongoDB Atlas! Cloud sync active.', 'success');
        checkDatabaseStatus();
        RosterManager.syncFromServer();
        AttendanceManager.syncFromServer();
        closeModal('modalDatabase');
      } else {
        showToast(`Could not connect: ${data.db?.lastError || 'Invalid credentials or network access'}`, 'error');
        checkDatabaseStatus();
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  }

  // =====================================================
  // EVENT MANAGEMENT
  // =====================================================

  function renderEventSelector() {
    const container = document.getElementById('eventSelectorBar');
    if (!container) return;

    const events = EventManager.getEvents();
    const activeEvent = EventManager.getActiveEvent();
    const isAdmin = AuthManager.isAdmin();

    const select = document.getElementById('eventSelectDropdown');
    if (select) {
      select.innerHTML = `<option value="none">— No Event (General Mode) —</option>`
        + events.map(e => `<option value="${escapeHtml(e.id)}" ${activeEvent && activeEvent.id === e.id ? 'selected' : ''}>${escapeHtml(e.name)} (${escapeHtml(e.date)})</option>`).join('');
    }

    const activeLabel = document.getElementById('activeEventLabel');
    if (activeLabel) {
      if (activeEvent) {
        activeLabel.innerHTML = `<i class="fa-solid fa-calendar-check"></i> <strong>${escapeHtml(activeEvent.name)}</strong> <span class="text-subtle">• ${escapeHtml(activeEvent.date)}</span>`;
        activeLabel.style.display = '';
      } else {
        activeLabel.innerHTML = `<i class="fa-solid fa-globe"></i> <span class="text-subtle">General Mode (No Event Selected)</span>`;
        activeLabel.style.display = '';
      }
    }

    // Show/hide event management buttons for admin
    const manageBtn = document.getElementById('btnManageEvents');
    if (manageBtn) manageBtn.style.display = isAdmin ? '' : 'none';
    const createBtn = document.getElementById('btnCreateEvent');
    if (createBtn) createBtn.style.display = isAdmin ? '' : 'none';

    // Show/hide register-to-event button
    const regBtn = document.getElementById('btnRegisterToEvent');
    if (regBtn) regBtn.classList.toggle('hidden', !(isAdmin && activeEvent));
  }

  function handleEventSwitch() {
    const select = document.getElementById('eventSelectDropdown');
    if (!select) return;
    const eventId = select.value;
    EventManager.setActiveEvent(eventId === 'none' ? null : eventId);
    showToast(eventId === 'none' ? 'Switched to General Mode' : `Switched to event: ${EventManager.getActiveEvent()?.name}`, 'info');
  }

  async function submitCreateEvent(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('newEventName')?.value;
    const date = document.getElementById('newEventDate')?.value;
    const description = document.getElementById('newEventDesc')?.value || '';

    if (!name || !date) {
      showToast('Event name and date are required.', 'warning');
      return;
    }

    const event = await EventManager.createEvent({ name, date, description });
    if (event) {
      closeModal('modalCreateEvent');
      document.getElementById('formCreateEvent')?.reset();
      EventManager.setActiveEvent(event.id);
      showToast(`Event "${event.name}" created and set as active!`, 'success');
      renderEventSelector();
      renderEventsTable();
    } else {
      showToast('Failed to create event.', 'error');
    }
  }

  function renderEventsTable() {
    const tbody = document.getElementById('eventsTableBody');
    if (!tbody) return;

    const events = EventManager.getEvents();
    const activeEventId = EventManager.getActiveEventId();

    if (events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-placeholder" style="padding:2rem;text-align:center;"><i class="fa-solid fa-calendar-xmark" style="font-size:1.5rem;opacity:0.4;display:block;margin-bottom:0.5rem;"></i>No events created yet.</td></tr>';
      return;
    }

    tbody.innerHTML = events.map((evt, idx) => {
      const isActive = activeEventId === evt.id;
      return `
        <tr class="${isActive ? 'event-row-active' : ''}">
          <td class="text-subtle col-w-50">${idx + 1}</td>
          <td><strong>${escapeHtml(evt.name)}</strong>${isActive ? ' <span class="tag tag-present"><i class="fa-solid fa-star"></i> Active</span>' : ''}</td>
          <td class="font-mono text-cyan">${escapeHtml(evt.date)}</td>
          <td>${escapeHtml(evt.description || '—')}</td>
          <td class="text-right">
            <div class="row-action-btns">
              ${!isActive ? `<button class="btn btn-primary btn-sm" onclick="App.activateEvent('${evt.id}')" title="Set as Active Event"><i class="fa-solid fa-play"></i></button>` : `<button class="btn btn-secondary btn-sm" onclick="App.activateEvent('none')" title="Deactivate Event"><i class="fa-solid fa-stop"></i></button>`}
              <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteEvent('${evt.id}', '${escapeHtml(evt.name).replace(/'/g, '\\&#039;')}')" title="Delete Event"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function activateEvent(eventId) {
    EventManager.setActiveEvent(eventId === 'none' ? null : eventId);
    const evt = EventManager.getActiveEvent();
    showToast(evt ? `Activated: ${evt.name}` : 'Deactivated event (General Mode)', 'info');
    renderEventsTable();
  }

  async function confirmDeleteEvent(eventId, eventName) {
    if (confirm(`Delete event "${eventName}"? This will permanently erase all its attendance data.`)) {
      const success = await EventManager.deleteEvent(eventId);
      if (success) {
        showToast(`Event "${eventName}" deleted.`, 'info');
        renderEventsTable();
        refreshAllViews();
      } else {
        showToast('Failed to delete event.', 'error');
      }
    }
  }

  function openManageEventsModal() {
    renderEventsTable();
    openModal('modalManageEvents');
  }

  // Register all roster students to active event
  async function registerAllStudentsToEvent() {
    const activeEvent = EventManager.getActiveEvent();
    if (!activeEvent) {
      showToast('No active event selected.', 'warning');
      return;
    }
    const students = RosterManager.getAllStudents();
    if (students.length === 0) {
      showToast('No students in roster to register.', 'warning');
      return;
    }
    const rollNumbers = students.map(s => s.rollNo);
    const result = await EventManager.registerStudents(activeEvent.id, rollNumbers);
    showToast(`Registered ${result.added || rollNumbers.length} students to "${activeEvent.name}"!`, 'success');
    refreshAllViews();
  }

  // =====================================================
  // WALK-IN REGISTRATION
  // =====================================================

  function openWalkinModal(data) {
    const modal = document.getElementById('modalWalkinRegister');
    if (!modal) return;

    document.getElementById('walkinRollNo').textContent = data.rollNo || '';
    document.getElementById('walkinBranch').textContent = data.branch || 'Unknown';
    document.getElementById('walkinYear').textContent = data.year || 'Unknown';
    document.getElementById('walkinNameInput').value = data.name || '';
    document.getElementById('walkinHiddenRollNo').value = data.rollNo || '';
    document.getElementById('walkinHiddenBranch').value = data.branch || '';
    document.getElementById('walkinHiddenYear').value = data.year || '';
    document.getElementById('walkinHiddenSection').value = data.section || '';

    const statusMsg = document.getElementById('walkinStatusMsg');
    if (statusMsg) {
      if (data.isNewStudent) {
        statusMsg.innerHTML = '<i class="fa-solid fa-user-slash"></i> Student is <strong>NOT in the roster</strong> and not registered for this event.';
      } else {
        statusMsg.innerHTML = '<i class="fa-solid fa-calendar-xmark"></i> Student exists in roster but is <strong>NOT registered for this event</strong>.';
      }
    }

    const activeEvent = EventManager.getActiveEvent();
    const eventLabel = document.getElementById('walkinEventName');
    if (eventLabel && activeEvent) {
      eventLabel.textContent = activeEvent.name;
    }

    openModal('modalWalkinRegister');
  }

  async function submitWalkinApprove(e) {
    if (e) e.preventDefault();

    const rollNo = document.getElementById('walkinHiddenRollNo')?.value;
    const name = document.getElementById('walkinNameInput')?.value || `Student ${rollNo}`;
    const branch = document.getElementById('walkinHiddenBranch')?.value;
    const year = document.getElementById('walkinHiddenYear')?.value;
    const section = document.getElementById('walkinHiddenSection')?.value;

    if (!rollNo) {
      showToast('Invalid roll number.', 'error');
      return;
    }

    // 1. Add to global roster if not already there
    let student = RosterManager.findStudent(rollNo);
    if (!student) {
      try {
        student = RosterManager.addStudent({
          rollNo, name, branch, year, section,
          assignedTo: 'all'
        });
      } catch (err) {
        student = RosterManager.findStudent(rollNo);
      }
    } else if (name && name !== `Student ${rollNo}`) {
      // Update name if provided
      try { RosterManager.updateStudent(rollNo, { name }); student.name = name; } catch (e) {}
    }

    // 2. Register to active event
    const activeEvent = EventManager.getActiveEvent();
    if (activeEvent) {
      await EventManager.registerStudents(activeEvent.id, [rollNo]);
    }

    // 3. Mark attendance with walkIn flag
    if (student) {
      student.walkIn = true;
    }

    closeModal('modalWalkinRegister');

    // 4. Re-process the scan with forceWalkin=true to mark attendance
    ScannerEngine.processRollNumber(rollNo, true);
    showToast(`Walk-in registered: ${name} (${rollNo})`, 'success');
  }

  function submitWalkinReject() {
    closeModal('modalWalkinRegister');
    showToast('Walk-in rejected. Student was not registered.', 'info');
  }

  return {
    init,
    switchTab,
    simulateScan,
    openViewQR,
    handleManualSubmit,
    openModal,
    closeModal,
    openDatabaseModal,
    toggleDbUriVisibility,
    testDatabaseConnection,
    submitDatabaseConfig,
    checkDatabaseStatus,
    submitAddStudent,
    openEditStudentModal,
    submitEditStudent,
    toggleStudentAttendance,
    exportRosterCSV,
    confirmClearAllStudents,
    executePermanentClear,
    clearAllStudents,
    handleGoogleFormFileUpload,
    openBranchRulesModal,
    submitClassificationRule,
    editClassificationRule,
    deleteClassificationRule,
    submitAddBranchRule,
    deleteBranchRuleEntry,
    clearAnalyticsDateFilter,
    submitImportGoogleForm,
    loadSampleGoogleFormTemplate,
    deleteStudent,
    deleteRecord,
    resetRosterToDefault,
    clearAttendanceLogs,
    exportAttendanceCSV,
    exportAttendancePDF,
    exportPresentTodayPDF,
    exportPresentStudentsPDF,
    submitExportPresentModal,
    showToast,
    setBtnLoading,
    refreshAllViews,
    handleLogout,
    submitAddAccount,
    deleteAccountEntry,
    renderAccountsTable,
    filterRoster: () => renderRosterTable(),
    // Event Management
    renderEventSelector,
    handleEventSwitch,
    submitCreateEvent,
    renderEventsTable,
    activateEvent,
    confirmDeleteEvent,
    openManageEventsModal,
    registerAllStudentsToEvent,
    // Walk-in Registration
    openWalkinModal,
    submitWalkinApprove,
    submitWalkinReject
  };
})();

// Bootstrap on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
