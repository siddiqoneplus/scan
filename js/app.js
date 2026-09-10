/**
 * MAIN APPLICATION CONTROLLER
 * Coordinates tabs, modal dialogs, UI updates, live tickers,
 * employee student assignment, and quick-simulator test actions.
 */

const App = (() => {
  let activeTab = 'scanner';

  function init() {
    // Initialize auth
    AuthManager.init();

    // Auth guard: redirect to login if not authenticated
    if (!AuthManager.isLoggedIn()) {
      window.location.href = 'login.html';
      return;
    }

    // Initialize components
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
    });

    // Listen for attendance updates
    window.addEventListener('attendance:updated', () => {
      updateKPIs();
      renderLiveTicker();
      renderAttendanceTable();
      AttendanceManager.renderCharts();
    });

    // Cross-tab real-time storage event synchronization
    window.addEventListener('storage', (e) => {
      if (e.key === 'smart_attendance_roster') {
        RosterManager.loadStudents();
        refreshAllViews();
      } else if (e.key === 'smart_attendance_logs') {
        AttendanceManager.loadLogs();
        refreshAllViews();
      }
    });

    // Background sync from server every 5 seconds to keep all employees & admins in sync
    setInterval(() => {
      RosterManager.syncFromServer();
      AttendanceManager.syncFromServer();
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
    updateKPIs();
    renderLiveTicker();
    renderRosterTable();
    renderAttendanceTable();
    renderSimulatorChips();
    QRStudio.renderStudentBadges();
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

  function simulateScan(rollNo) {
    if (activeTab !== 'scanner') {
      switchTab('scanner');
    }
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
        const classified = RosterManager.autoClassifyRollNumber(val);
        branchInput.value = classified.branch;
        yearInput.value = classified.year;
        if (hint) {
          hint.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-detected: <strong>${classified.branch}</strong> • <strong>${classified.year}</strong>`;
          hint.style.display = 'block';
        }
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
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';

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
    const dateFilter = document.getElementById('analyticsFilterDate');

    const triggerFilter = () => {
      const filtered = AttendanceManager.getFilteredLogs({
        query: searchInput ? searchInput.value : '',
        branch: branchFilter ? branchFilter.value : 'ALL',
        year: yearFilter ? yearFilter.value : 'ALL',
        date: dateFilter ? dateFilter.value : ''
      });
      renderAttendanceTable(filtered);
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
    if (dateFilter) dateFilter.addEventListener('change', triggerFilter);
  }

  function renderAttendanceTable(records = null) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!records) {
      records = AttendanceManager.getAllLogs();
    }

    if (records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-placeholder">
            No attendance records logged for this filter.
          </td>
        </tr>
      `;
      return;
    }

    const isAdmin = AuthManager.isAdmin();

    tbody.innerHTML = records.map((r, idx) => {
      return `
      <tr>
        <td class="text-subtle col-w-50">${idx + 1}</td>
        <td class="font-mono font-semibold text-white">${escapeHtml(r.rollNo)}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="tag tag-branch">${escapeHtml(r.branch)}</span></td>
        <td><span class="tag tag-year">${escapeHtml(r.year)}</span></td>
        <td class="font-mono text-cyan">${escapeHtml(r.timestamp)}</td>
        <td><span class="tag tag-session">${escapeHtml(r.session)}</span></td>
        <td><span class="tag tag-session"><i class="fa-solid fa-id-badge"></i> ${escapeHtml(r.markedBy || 'Staff Member')}</span></td>
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
        const sessionSpan = document.getElementById('modalExportActiveSession');
        if (todaySpan) todaySpan.textContent = AttendanceManager.getTodayDateStr();
        if (sessionSpan) {
          const session = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
          sessionSpan.textContent = session;
        }
      }
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  function submitAddStudent(e) {
    if (e) e.preventDefault();
    const rollNo = document.getElementById('newStudentRoll')?.value;
    const name = document.getElementById('newStudentName')?.value;
    const branch = document.getElementById('newStudentBranch')?.value;
    const year = document.getElementById('newStudentYear')?.value;
    const section = document.getElementById('newStudentSection')?.value || '';
    const assignedTo = document.getElementById('newStudentAssignedTo')?.value || 'all';

    try {
      RosterManager.addStudent({ rollNo, name, branch, year, section, assignedTo });
      closeModal('modalAddStudent');
      const assignLabel = assignedTo === 'all' ? 'All Employees' : assignedTo;
      showToast(`Student ${rollNo} registered & assigned to ${assignLabel}!`, 'success');
      document.getElementById('formAddStudent').reset();
      refreshAllViews();
    } catch (err) {
      showToast(err.message, 'error');
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
      const result = await RosterManager.importGoogleFormCSV(csvContent, assignedTo);
      closeModal('modalGoogleForm');
      const assignLabel = assignedTo === 'all' ? 'All Employees' : assignedTo;
      showToast(`Imported ${result.importedCount} students & assigned to ${assignLabel}! (${result.skippedCount} skipped)`, 'success');
      document.getElementById('gformCsvInput').value = '';
      refreshAllViews();
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

  function submitEditStudent(e) {
    if (e) e.preventDefault();
    const rollNo = document.getElementById('editStudentRoll')?.value;
    const name = document.getElementById('editStudentName')?.value;
    const branch = document.getElementById('editStudentBranch')?.value;
    const year = document.getElementById('editStudentYear')?.value;
    const section = document.getElementById('editStudentSection')?.value || '';
    const assignedTo = document.getElementById('editStudentAssignedTo')?.value || 'all';

    try {
      RosterManager.updateStudent(rollNo, { name, branch, year, section, assignedTo });
      closeModal('modalEditStudent');
      showToast(`Student ${rollNo} updated successfully!`, 'success');
      refreshAllViews();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function toggleStudentAttendance(rollNo) {
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
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

  function clearAllStudents() {
    if (confirm('Are you sure you want to CLEAR the entire student whitelist? This cannot be undone.')) {
      RosterManager.clearAll();
      showToast('Student whitelist cleared', 'info');
      refreshAllViews();
    }
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
    const dateInput = document.getElementById('analyticsFilterDate');
    if (dateInput) {
      dateInput.value = '';
      renderAttendanceTable();
      showToast('Showing records for all dates', 'info');
    }
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
    if (confirm('Are you sure you want to clear all students from the whitelist?')) {
      RosterManager.clearAll();
      showToast('Student whitelist cleared', 'info');
      refreshAllViews();
    }
  }

  function clearAttendanceLogs() {
    if (confirm('Clear all recorded attendance logs for today?')) {
      AttendanceManager.clearAllLogs();
      showToast('Attendance logs cleared', 'info');
    }
  }

  function exportAttendanceCSV() {
    try {
      const query = document.getElementById('analyticsSearch')?.value || '';
      const branch = document.getElementById('analyticsFilterBranch')?.value || 'ALL';
      const year = document.getElementById('analyticsFilterYear')?.value || 'ALL';
      const date = document.getElementById('analyticsFilterDate')?.value || '';

      const records = AttendanceManager.getFilteredLogs({
        query,
        branch,
        year,
        date: date || null
      });

      AttendanceManager.exportCSV(records);
      showToast(`Exported ${records.length} attendance records as CSV!`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  /**
   * Export the currently filtered attendance logs as a styled PDF report
   */
  function exportAttendancePDF() {
    try {
      const query = document.getElementById('analyticsSearch')?.value || '';
      const branch = document.getElementById('analyticsFilterBranch')?.value || 'ALL';
      const year = document.getElementById('analyticsFilterYear')?.value || 'ALL';
      const date = document.getElementById('analyticsFilterDate')?.value || '';
      const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';

      const records = AttendanceManager.getFilteredLogs({
        query,
        branch,
        year,
        date: date || null
      });

      if (records.length === 0) {
        showToast('No attendance records found matching current filters.', 'warning');
        return;
      }

      const filterDesc = [
        branch !== 'ALL' ? branch : null,
        year !== 'ALL' ? year : null,
        query ? `Search: "${query}"` : null,
        date ? date : 'All Dates'
      ].filter(Boolean).join(' • ') || 'All Filtered Records';

      AttendanceManager.exportPDF(records, {
        title: 'Present Students Attendance Report',
        dateStr: date || AttendanceManager.getTodayDateStr(),
        sessionName: activeSession,
        filterDesc: filterDesc,
        uniqueOnly: false,
        includeSummary: true
      });

      showToast(`Downloaded PDF report (${records.length} records)!`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  /**
   * Quick export of today's present students as a clean, deduplicated PDF report
   */
  function exportPresentTodayPDF() {
    try {
      const today = AttendanceManager.getTodayDateStr();
      const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
      const records = AttendanceManager.getFilteredLogs({ date: today });

      if (records.length === 0) {
        showToast('No students have checked in as present today yet.', 'warning');
        return;
      }

      const uniqueRecords = AttendanceManager.deduplicateRecords(records);

      AttendanceManager.exportPDF(uniqueRecords, {
        title: "Today's Present Students Report",
        dateStr: `${today} (Today)`,
        sessionName: activeSession,
        filterDesc: 'Today Check-ins (Unique Students)',
        uniqueOnly: true,
        includeSummary: true
      });

      showToast(`Downloaded PDF for ${uniqueRecords.length} present students!`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  /**
   * Export present students for active session/day from the Admin Roster toolbar
   */
  function exportPresentStudentsPDF() {
    try {
      const today = AttendanceManager.getTodayDateStr();
      const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
      
      let records = AttendanceManager.getFilteredLogs({ date: today, session: activeSession });
      if (records.length === 0) {
        records = AttendanceManager.getFilteredLogs({ date: today });
      }

      if (records.length === 0) {
        showToast('No students are currently marked present for today.', 'warning');
        return;
      }

      const uniqueRecords = AttendanceManager.deduplicateRecords(records);

      AttendanceManager.exportPDF(uniqueRecords, {
        title: `Present Students Report — ${activeSession}`,
        dateStr: today,
        sessionName: activeSession,
        filterDesc: `${activeSession} • Unique Present Attendees`,
        uniqueOnly: true,
        includeSummary: true
      });

      showToast(`Exported ${uniqueRecords.length} present students as PDF!`, 'success');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  /**
   * Handle form submission from the Export Present modal
   */
  function submitExportPresentModal(event) {
    if (event) event.preventDefault();

    try {
      const form = document.getElementById('formExportPresent');
      const scope = form.elements['exportScope']?.value || 'today';
      const format = form.elements['exportFormat']?.value || 'pdf';
      const uniqueOnly = document.getElementById('exportUniqueOnly')?.checked ?? true;
      const includeSummary = document.getElementById('exportIncludeSummary')?.checked ?? true;

      const today = AttendanceManager.getTodayDateStr();
      const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';

      let records = [];
      let title = 'Present Students Attendance Report';
      let dateStr = today;
      let filterDesc = 'Custom Report';

      if (scope === 'today') {
        records = AttendanceManager.getFilteredLogs({ date: today });
        title = "Today's Present Students Report";
        filterDesc = `Today (${today}) Check-ins`;
      } else if (scope === 'session') {
        records = AttendanceManager.getFilteredLogs({ date: today, session: activeSession });
        title = `Present Students — ${activeSession}`;
        filterDesc = `Active Session: ${activeSession} on ${today}`;
      } else if (scope === 'filtered') {
        const query = document.getElementById('analyticsSearch')?.value || '';
        const branch = document.getElementById('analyticsFilterBranch')?.value || 'ALL';
        const year = document.getElementById('analyticsFilterYear')?.value || 'ALL';
        const date = document.getElementById('analyticsFilterDate')?.value || '';
        records = AttendanceManager.getFilteredLogs({ query, branch, year, date: date || null });
        title = 'Filtered Attendance Records Report';
        dateStr = date || today;
        filterDesc = [
          branch !== 'ALL' ? branch : null,
          year !== 'ALL' ? year : null,
          query ? `Search: "${query}"` : null,
          date ? `Date: ${date}` : 'All Dates'
        ].filter(Boolean).join(' • ') || 'All Filtered Records';
      } else {
        records = AttendanceManager.getAllLogs();
        title = 'All Historical Attendance Records';
        dateStr = 'All-Time Records';
        filterDesc = 'Complete Attendance Archive';
      }

      if (records.length === 0) {
        showToast('No records match the selected scope.', 'warning');
        return;
      }

      const finalRecords = uniqueOnly ? AttendanceManager.deduplicateRecords(records) : records;

      if (format === 'pdf') {
        AttendanceManager.exportPDF(finalRecords, {
          title,
          dateStr,
          sessionName: activeSession,
          filterDesc,
          uniqueOnly: false, // already deduplicated above if checked
          includeSummary
        });
        showToast(`Downloaded PDF with ${finalRecords.length} present records!`, 'success');
      } else if (format === 'csv') {
        AttendanceManager.exportCSV(finalRecords, {
          uniqueOnly: false,
          filename: `Present_Students_${scope}_${today}.csv`
        });
        showToast(`Exported CSV with ${finalRecords.length} present records!`, 'success');
      } else if (format === 'print') {
        AttendanceManager.printReport(finalRecords, {
          title,
          dateStr,
          sessionName: activeSession,
          uniqueOnly: false
        });
        showToast(`Opened print preview for ${finalRecords.length} present records.`, 'info');
      }

      closeModal('modalExportPresent');
    } catch (e) {
      showToast(e.message, 'warning');
    }
  }

  function bindSimulator() {
    // Quick simulator chip listeners handled inline or via delegate
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

  return {
    init,
    switchTab,
    simulateScan,
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
    clearAllStudents,
    handleGoogleFormFileUpload,
    openBranchRulesModal,
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
    refreshAllViews,
    handleLogout,
    submitAddAccount,
    deleteAccountEntry,
    renderAccountsTable,
    filterRoster: () => renderRosterTable()
  };
})();

// Bootstrap on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
