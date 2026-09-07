/**
 * MAIN APPLICATION CONTROLLER
 * Coordinates tabs, modal dialogs, UI updates, live tickers,
 * and quick-simulator test actions.
 */

const App = (() => {
  let activeTab = 'scanner';

  function init() {
    // Initialize components
    RosterManager.init();
    AttendanceManager.init();

    // Bind event listeners
    bindNavigation();
    bindRosterUI();
    bindAnalyticsUI();
    bindModals();
    bindSimulator();

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
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-subtle); font-size: 0.825rem;">
          <i class="fa-solid fa-clock-rotate-left" style="font-size: 1.5rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
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

    const students = RosterManager.getAllStudents().slice(0, 6);
    let html = students.map(s => `
      <button class="sim-chip" onclick="App.simulateScan('${s.rollNo}')" title="Click to test scan ${s.name}">
        <i class="fa-solid fa-qrcode"></i> ${escapeHtml(s.rollNo)} (${escapeHtml(s.name.split(' ')[0])})
      </button>
    `).join('');

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

  function renderRosterTable(query = '', branch = 'ALL', year = 'ALL') {
    const tbody = document.getElementById('rosterTableBody');
    if (!tbody) return;

    let students = RosterManager.getAllStudents();
    const q = query.toLowerCase().trim();

    students = students.filter(s => {
      if (branch !== 'ALL' && s.branch !== branch) return false;
      if (year !== 'ALL' && s.year !== year) return false;
      if (q && !s.rollNo.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            No student records found. Import Google Form responses or add students above.
          </td>
        </tr>
      `;
      return;
    }

    const today = AttendanceManager.getTodayDateStr();
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';

    tbody.innerHTML = students.map((s, idx) => {
      const isPresent = AttendanceManager.isAlreadyMarked(s.rollNo, activeSession);
      return `
        <tr>
          <td style="color: var(--text-subtle);">${idx + 1}</td>
          <td class="font-mono" style="font-weight: 600; color: #fff;">${escapeHtml(s.rollNo)}</td>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td><span class="tag tag-branch">${escapeHtml(s.branch)}</span></td>
          <td><span class="tag tag-year">${escapeHtml(s.year)}</span></td>
          <td>
            ${isPresent 
              ? `<span class="tag" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7;"><i class="fa-solid fa-check"></i> Present</span>` 
              : `<span class="tag" style="background: rgba(239, 68, 68, 0.15); color: #f87171;"><i class="fa-solid fa-xmark"></i> Absent</span>`}
          </td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick="App.simulateScan('${s.rollNo}')" title="Test Scan">
              <i class="fa-solid fa-barcode"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteStudent('${s.rollNo}')" title="Delete Student">
              <i class="fa-solid fa-trash"></i>
            </button>
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
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            No attendance records match your filter criteria.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = records.map((r, idx) => `
      <tr>
        <td style="color: var(--text-subtle);">${idx + 1}</td>
        <td class="font-mono" style="font-weight: 600; color: #fff;">${escapeHtml(r.rollNo)}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="tag tag-branch">${escapeHtml(r.branch)}</span></td>
        <td><span class="tag tag-year">${escapeHtml(r.year)}</span></td>
        <td class="font-mono" style="color: var(--cyan);">${escapeHtml(r.timestamp)}</td>
        <td><span class="tag tag-session">${escapeHtml(r.session)}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-sm" onclick="App.deleteRecord('${r.id}')" title="Delete record">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
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
      AttendanceManager.exportCSV();
      showToast('Attendance report downloaded as CSV!', 'success');
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

  return {
    init,
    switchTab,
    simulateScan,
    handleManualSubmit,
    openModal,
    closeModal,
    submitAddStudent,
    submitImportGoogleForm,
    loadSampleGoogleFormTemplate,
    deleteStudent,
    deleteRecord,
    resetRosterToDefault,
    clearAttendanceLogs,
    exportAttendanceCSV,
    showToast,
    refreshAllViews
  };
})();

// Bootstrap on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
