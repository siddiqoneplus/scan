/**
 * ATTENDANCE ANALYTICS & LOGGING ENGINE
 * Manages check-in records, duplicate prevention, statistics,
 * Chart.js visual data binding, and Google Sheets/Excel CSV export.
 */

const AttendanceManager = (() => {
  const STORAGE_KEY = 'smart_attendance_logs';
  let logs = [];
  let branchChartInstance = null;
  let yearChartInstance = null;

  function init() {
    loadLogs();
  }

  function loadLogs() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        logs = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse attendance logs', e);
        logs = [];
      }
    } else {
      // Create a couple of sample records for today's demo
      const today = getTodayDateStr();
      logs = [
        {
          id: 'att-' + Date.now() + '-1',
          rollNo: '24A81A4401',
          name: 'Aarav Sharma',
          branch: 'Data Science (DS)',
          year: '2024 Batch (1st Year)',
          session: 'Morning Lecture',
          date: today,
          timestamp: new Date(Date.now() - 3600000 * 2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          status: 'Present'
        },
        {
          id: 'att-' + Date.now() + '-2',
          rollNo: '24A81A6101',
          name: 'Charan Teja',
          branch: 'AIML (AI & Machine Learning)',
          year: '2024 Batch (1st Year)',
          session: 'Morning Lecture',
          date: today,
          timestamp: new Date(Date.now() - 3600000 * 1.5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          status: 'Present'
        },
        {
          id: 'att-' + Date.now() + '-3',
          rollNo: '24A81A4301',
          name: 'Eshwar Kumar',
          branch: 'CAI (Computer Science & AI)',
          year: '2024 Batch (1st Year)',
          session: 'Morning Lecture',
          date: today,
          timestamp: new Date(Date.now() - 3600000 * 0.8).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          status: 'Present'
        }
      ];
      saveLogs();
    }
  }

  function saveLogs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    window.dispatchEvent(new CustomEvent('attendance:updated', { detail: { count: logs.length } }));
  }

  function getTodayDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Check if a student is already marked present today for the given session
   */
  function isAlreadyMarked(rollNo, sessionName) {
    const today = getTodayDateStr();
    const cleanRoll = rollNo.trim().toUpperCase();
    return logs.some(record => 
      record.rollNo.toUpperCase() === cleanRoll &&
      record.date === today &&
      (sessionName ? record.session === sessionName : true)
    );
  }

  /**
   * Record new attendance
   */
  function recordAttendance(student, sessionName = 'Morning Lecture') {
    if (!student || !student.rollNo) {
      return { success: false, reason: 'Invalid student profile' };
    }

    const cleanRoll = student.rollNo.trim().toUpperCase();
    const today = getTodayDateStr();

    if (isAlreadyMarked(cleanRoll, sessionName)) {
      const existing = logs.find(r => r.rollNo.toUpperCase() === cleanRoll && r.date === today && r.session === sessionName);
      return {
        success: false,
        isDuplicate: true,
        record: existing,
        reason: `Student ${cleanRoll} is already marked Present for ${sessionName} today at ${existing.timestamp}.`
      };
    }

    const now = new Date();
    const newRecord = {
      id: 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      rollNo: cleanRoll,
      name: student.name,
      branch: student.branch,
      year: student.year,
      session: sessionName,
      date: today,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      status: 'Present'
    };

    logs.unshift(newRecord);
    saveLogs();

    return {
      success: true,
      record: newRecord
    };
  }

  /**
   * Delete attendance record
   */
  function deleteRecord(recordId) {
    logs = logs.filter(r => r.id !== recordId);
    saveLogs();
  }

  /**
   * Clear all records
   */
  function clearAllLogs() {
    logs = [];
    saveLogs();
  }

  /**
   * Get filtered logs
   */
  function getFilteredLogs({ date, branch, year, session, query } = {}) {
    return logs.filter(r => {
      if (date && r.date !== date) return false;
      if (branch && branch !== 'ALL' && r.branch !== branch && !r.branch.includes(branch) && !branch.includes(r.branch)) return false;
      if (year && year !== 'ALL' && r.year !== year && !r.year.includes(year) && !year.includes(r.year)) return false;
      if (session && session !== 'ALL' && r.session !== session) return false;
      if (query) {
        const q = query.toLowerCase().trim();
        const match = r.rollNo.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }

  /**
   * Calculate summary metrics
   */
  function getMetrics() {
    const totalRegistered = RosterManager.getAllStudents().length;
    const today = getTodayDateStr();
    const todayLogs = logs.filter(r => r.date === today);

    // Unique students present today
    const uniquePresentToday = new Set(todayLogs.map(r => r.rollNo.toUpperCase())).size;
    const attendanceRate = totalRegistered > 0 
      ? Math.round((uniquePresentToday / totalRegistered) * 100) 
      : 0;

    // Branch breakdown
    const branchCounts = {};
    todayLogs.forEach(r => {
      const b = r.branch || 'Other';
      branchCounts[b] = (branchCounts[b] || 0) + 1;
    });

    // Year breakdown
    const yearCounts = {};
    todayLogs.forEach(r => {
      const y = r.year || 'Other';
      yearCounts[y] = (yearCounts[y] || 0) + 1;
    });

    return {
      totalRegistered,
      totalPresentToday: uniquePresentToday,
      totalScansToday: todayLogs.length,
      attendanceRate,
      branchCounts,
      yearCounts,
      todayStr: today
    };
  }

  /**
   * Export attendance data as CSV for Google Sheets / Microsoft Excel
   */
  function exportCSV(filtered = null) {
    const dataToExport = filtered || logs;
    if (dataToExport.length === 0) {
      throw new Error('No attendance records available to export.');
    }

    const headers = ['Roll Number', 'Student Name', 'Branch', 'Year', 'Date', 'Time', 'Session', 'Status'];
    const rows = dataToExport.map(r => [
      `"${r.rollNo}"`,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.branch.replace(/"/g, '""')}"`,
      `"${r.year}"`,
      `"${r.date}"`,
      `"${r.timestamp}"`,
      `"${r.session.replace(/"/g, '""')}"`,
      `"${r.status}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Smart_Attendance_Report_${getTodayDateStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Initialize / Update Chart.js visualizations
   */
  function renderCharts() {
    if (typeof Chart === 'undefined') return;

    const metrics = getMetrics();
    const branchCanvas = document.getElementById('chartBranch');
    const yearCanvas = document.getElementById('chartYear');

    if (branchCanvas) {
      const branchLabels = Object.keys(metrics.branchCounts);
      const branchData = Object.values(metrics.branchCounts);

      if (branchChartInstance) {
        branchChartInstance.destroy();
      }

      branchChartInstance = new Chart(branchCanvas, {
        type: 'bar',
        data: {
          labels: branchLabels.length > 0 ? branchLabels : ['No data today'],
          datasets: [{
            label: 'Present Students',
            data: branchData.length > 0 ? branchData : [0],
            backgroundColor: 'rgba(16, 185, 129, 0.65)',
            borderColor: '#10b981',
            borderWidth: 1.5,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#111726',
              titleColor: '#fff',
              bodyColor: '#94a3b8',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1
            }
          },
          scales: {
            x: {
              ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
              grid: { color: 'rgba(255,255,255,0.05)' }
            },
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
              grid: { color: 'rgba(255,255,255,0.05)' }
            }
          }
        }
      });
    }

    if (yearCanvas) {
      const yearLabels = Object.keys(metrics.yearCounts);
      const yearData = Object.values(metrics.yearCounts);

      if (yearChartInstance) {
        yearChartInstance.destroy();
      }

      yearChartInstance = new Chart(yearCanvas, {
        type: 'doughnut',
        data: {
          labels: yearLabels.length > 0 ? yearLabels : ['No data today'],
          datasets: [{
            data: yearData.length > 0 ? yearData : [1],
            backgroundColor: [
              'rgba(16, 185, 129, 0.75)',
              'rgba(6, 182, 212, 0.75)',
              'rgba(139, 92, 246, 0.75)',
              'rgba(245, 158, 11, 0.75)'
            ],
            borderColor: '#111726',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 }, boxWidth: 14 }
            },
            tooltip: {
              backgroundColor: '#111726',
              titleColor: '#fff',
              bodyColor: '#94a3b8',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1
            }
          },
          cutout: '65%'
        }
      });
    }
  }

  return {
    init,
    getAllLogs: () => [...logs],
    getFilteredLogs,
    isAlreadyMarked,
    recordAttendance,
    deleteRecord,
    clearAllLogs,
    getMetrics,
    exportCSV,
    renderCharts,
    getTodayDateStr
  };
})();
