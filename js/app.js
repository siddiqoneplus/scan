/**
 * MAIN APPLICATION CONTROLLER
 * Coordinates tabs, modal dialogs, UI updates, live tickers,
 * and quick-simulator test actions.
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

    // Admin-only tabs: Roster, QR Studio
    const rosterTab = document.getElementById('tabBtnRoster');
    const cardsTab = document.getElementById('tabBtnCards');
    if (rosterTab) rosterTab.style.display = isAdmin ? '' : 'none';
    if (cardsTab) cardsTab.style.display = isAdmin ? '' : 'none';

    // Admin-only elements (manage accounts button, etc.)
    document.querySelectorAll('.admin-only-el').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    // Employee restrictions: hide simulator bar, destructive buttons
    if (!isAdmin) {
      // Hide simulator chips bar
      const simBar = document.querySelector('.quick-simulator-bar');
      if (simBar) simBar.style.display = 'none';

      // Hide clear logs & delete buttons in analytics (applied later on render)
    }
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
      // Pause camera to conserve device battery/CPU
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
    let html = students.map(s => {
      const branchAbbr = s.branch.split('(')[1]?.replace(')', '') || s.branch.split(' ')[0];
      return `
        <button class="sim-chip" onclick="App.simulateScan('${s.rollNo}')" title="Click to test scan ${s.name} (${s.branch})">
          <i class="fa-solid fa-qrcode"></i> <strong>${escapeHtml(s.rollNo)}</strong> <span class="sim-chip-tag">${escapeHtml(branchAbbr)}</span>
        </button>
      `;
    }).join('');

    // Add an unauthorized test chip
    html += `
      <button class="sim-chip invalid" onclick="App.simulateScan('99ZZ9A9999')" title="Simulate unassigned/invalid roll number">
        <i class="fa-solid fa-ban"></i> 99ZZ9A9999 (Unassigned)
      </button>
    `;

    container.innerHTML = html;
  }

  function simulateScan(rollNo) {
    // If currently on another tab, switch to scanner
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
    // Search input
    const searchInput = document.getElementById('rosterSearch');
    const branchFilter = document.getElementById('rosterFilterBranch');
    const yearFilter = document.getElementById('rosterFilterYear');

    const triggerFilter = () => {
      renderRosterTable(
        searchInput ? searchInput.value : '',
        branchFilter ? branchFilter.value : 'ALL',
        yearFilter ? yearFilter.value : 'ALL'
      );
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
  }

  function renderRosterTable(query = null, branch = null, year = null) {
    const tbody = document.getElementById('rosterTableBody');
    if (!tbody) return;

    const q = (query !== null ? query : (document.getElementById('rosterSearch')?.value || '')).toLowerCase().trim();
    const b = branch !== null ? branch : (document.getElementById('rosterFilterBranch')?.value || 'ALL');
    const y = year !== null ? year : (document.getElementById('rosterFilterYear')?.value || 'ALL');

    let students = RosterManager.getAllStudents();

    students = students.filter(s => {
      if (b !== 'ALL' && s.branch !== b && !s.branch.includes(b) && !b.includes(s.branch)) return false;
      if (y !== 'ALL' && s.year !== y && !s.year.includes(y) && !y.includes(s.year)) return false;
      if (q && !s.rollNo.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-placeholder">
            No student records found matching the criteria. Import Google Form responses or add students above.
          </td>
        </tr>
      `;
      return;
    }

    const today = AttendanceManager.getTodayDateStr();
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
    const isAdmin = AuthManager.isAdmin();

    tbody.innerHTML = students.map((s, idx) => {
      const isPresent = AttendanceManager.isAlreadyMarked(s.rollNo, activeSession);
      return `
        <tr>
          <td class="text-subtle col-w-50">${idx + 1}</td>
          <td class="font-mono font-semibold text-white">${escapeHtml(s.rollNo)}</td>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td><span class="tag tag-branch">${escapeHtml(s.branch)}</span></td>
          <td><span class="tag tag-year">${escapeHtml(s.year)}</span></td>
          <td>
            ${isPresent 
              ? `<span class="tag tag-present"><i class="fa-solid fa-check"></i> Present</span>` 
              : `<span class="tag tag-absent"><i class="fa-solid fa-xmark"></i> Absent</span>`}
          </td>
          <td class="text-right">
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
    const dateInput = document.getElementById('analyticsFilterDate');

    if (dateInput) {
      dateInput.value = AttendanceManager.getTodayDateStr();
    }

    const triggerFilter = () => {
      renderAttendanceTable();
    };

    if (searchInput) searchInput.addEventListener('input', triggerFilter);
    if (branchFilter) branchFilter.addEventListener('change', triggerFilter);
    if (yearFilter) yearFilter.addEventListener('change', triggerFilter);
    if (dateInput) dateInput.addEventListener('change', triggerFilter);
  }

  function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

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

    if (records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-placeholder">
            No attendance records match your filter criteria.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = records.map((r, idx) => {
      const isAdmin = AuthManager.isAdmin();
      return `
      <tr>
        <td class="text-subtle col-w-50">${idx + 1}</td>
        <td class="font-mono font-semibold text-white">${escapeHtml(r.rollNo)}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="tag tag-branch">${escapeHtml(r.branch)}</span></td>
        <td><span class="tag tag-year">${escapeHtml(r.year)}</span></td>
        <td class="font-mono text-cyan">${escapeHtml(r.timestamp)}</td>
        <td><span class="tag tag-session">${escapeHtml(r.session)}</span></td>
        <td class="text-right">
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="App.deleteRecord('${r.id}')" title="Delete record">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </td>
      </tr>
    `;
    }).join('');

    // Hide clear logs button for non-admins
    const clearBtn = document.querySelector('[onclick="App.clearAttendanceLogs()"]');
    if (clearBtn) clearBtn.style.display = AuthManager.isAdmin() ? '' : 'none';
  }

  function bindModals() {
    // Backdrop click close
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
      // Render accounts table if opening manage accounts modal
      if (modalId === 'modalManageAccounts') {
        renderAccountsTable();
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

    try {
      RosterManager.addStudent({ rollNo, name, branch, year });
      closeModal('modalAddStudent');
      showToast(`Student ${rollNo} added successfully!`, 'success');
      document.getElementById('formAddStudent').reset();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function submitImportGoogleForm() {
    const csvContent = document.getElementById('gformCsvInput')?.value;
    if (!csvContent || !csvContent.trim()) {
      showToast('Please paste Google Form CSV responses or tab data.', 'warning');
      return;
    }

    try {
      const result = RosterManager.importGoogleFormCSV(csvContent);
      closeModal('modalGoogleForm');
      showToast(`Imported ${result.importedCount} students successfully! (${result.skippedCount} skipped)`, 'success');
      document.getElementById('gformCsvInput').value = '';
    } catch (err) {
      showToast('Import Error: ' + err.message, 'error');
    }
  }

  function loadSampleGoogleFormTemplate() {
    const sampleCsv = `Timestamp,Student Name,Roll Number,Branch,Academic Year
2026/09/01 10:15:30 AM,Kunal Sen,22B91A0588,Computer Science (CSE),3rd Year
2026/09/01 10:16:45 AM,Aditi Rao,23-CSE-099,,2nd Year
2026/09/01 10:17:12 AM,Suresh Babu,21B91A0450,Electronics (ECE),4th Year
2026/09/01 10:18:05 AM,Harini Murugan,24-AIDS-055,,1st Year
2026/09/01 10:19:22 AM,Abhinav Sharma,24B91A0318,,`;

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
    const rollInput = document.getElementById('editStudentRoll');
    const nameInput = document.getElementById('editStudentName');
    const branchInput = document.getElementById('editStudentBranch');
    const yearInput = document.getElementById('editStudentYear');

    if (rollInput) rollInput.value = student.rollNo;
    if (nameInput) nameInput.value = student.name;
    if (branchInput) branchInput.value = student.branch;
    if (yearInput) yearInput.value = student.year;

    openModal('modalEditStudent');
  }

  function submitEditStudent(e) {
    if (e) e.preventDefault();
    const rollNo = document.getElementById('editStudentRoll')?.value;
    const name = document.getElementById('editStudentName')?.value;
    const branch = document.getElementById('editStudentBranch')?.value;
    const year = document.getElementById('editStudentYear')?.value;

    try {
      RosterManager.updateStudent(rollNo, { name, branch, year });
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
        showToast(`Loaded ${file.name} (${text.split(/\r\n|\n|\r/).length} lines). Click "Process Import" to finish!`, 'info');
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
    if (confirm('Reset student roster to default university demo list?')) {
      RosterManager.resetToDefault();
      showToast('Roster reset to default dataset', 'success');
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

  return {
    init,
    switchTab,
    simulateScan,
    handleManualSubmit,
    openModal,
    closeModal,
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
    showToast,
    refreshAllViews,
    handleLogout,
    submitAddAccount,
    deleteAccountEntry,
    renderAccountsTable
  };
})();

// Bootstrap on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
