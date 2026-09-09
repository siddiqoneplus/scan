/**
 * ATTENDANCE ANALYTICS & LOGGING ENGINE
 * Manages check-in records, duplicate prevention, statistics,
 * Chart.js visual data binding, multi-employee persistence, and CSV export.
 */

const AttendanceManager = (() => {
  const STORAGE_KEY = 'smart_attendance_logs';
  let logs = [];
  let branchChartInstance = null;
  let yearChartInstance = null;

  function init() {
    loadLogs();
    syncFromServer();
  }

  function loadLogs() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        logs = JSON.parse(saved);
        // Auto-resync log years to match current cohort rules
        let updated = false;
        logs.forEach(r => {
          if (r.rollNo && typeof RosterManager !== 'undefined') {
            const classified = RosterManager.autoClassifyRollNumber(r.rollNo);
            if (r.year !== classified.year) {
              r.year = classified.year;
              updated = true;
            }
          }
        });
        if (updated) saveLogs(false);
      } catch (e) {
        console.error('Failed to parse attendance logs', e);
        logs = [];
      }
    } else {
      logs = [];
    }
  }

  /**
   * Fetch logs from centralized backend server
   */
  async function syncFromServer() {
    try {
      const response = await fetch('/api/attendance');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.logs)) {
          const currentStr = JSON.stringify(logs);
          const newStr = JSON.stringify(data.logs);
          if (currentStr !== newStr) {
            logs = data.logs;
            localStorage.setItem(STORAGE_KEY, newStr);
            window.dispatchEvent(new CustomEvent('attendance:updated', { detail: { count: logs.length } }));
          }
        }
      }
    } catch (e) {
      // Offline fallback: use local logs
    }
  }

  function saveLogs(syncToServer = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    window.dispatchEvent(new CustomEvent('attendance:updated', { detail: { count: logs.length } }));

    if (syncToServer) {
      fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs })
      }).catch(err => console.warn('Could not sync attendance logs to server:', err));
    }
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

    const currentSession = (typeof AuthManager !== 'undefined') ? AuthManager.getSession() : null;
    const markedBy = currentSession ? `${currentSession.displayName} (${currentSession.role === 'admin' ? 'Admin' : 'Staff'})` : 'Staff Member';

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
      status: 'Present',
      markedBy: markedBy
    };

    logs.unshift(newRecord);
    saveLogs(true);

    return {
      success: true,
      record: newRecord
    };
  }

  /**
   * Delete attendance record by ID
   */
  function deleteRecord(recordId) {
    logs = logs.filter(r => r.id !== recordId);
    saveLogs(false);

    fetch('/api/attendance', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: recordId })
    }).catch(err => console.warn('Could not delete record on server:', err));
  }

  /**
   * Remove attendance for a specific student today
   */
  function removeAttendanceForStudent(rollNo, sessionName) {
    const today = getTodayDateStr();
    const cleanRoll = rollNo.trim().toUpperCase();
    const initialLen = logs.length;
    logs = logs.filter(r => !(r.rollNo.toUpperCase() === cleanRoll && r.date === today && (sessionName ? r.session === sessionName : true)));
    if (logs.length !== initialLen) {
      saveLogs(true);
      return true;
    }
    return false;
  }

  /**
   * Clear all records
   */
  function clearAllLogs() {
    logs = [];
    saveLogs(false);

    fetch('/api/attendance', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'all' })
    }).catch(err => console.warn('Could not clear logs on server:', err));
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
   * Deduplicate records to only unique students (first check-in)
   */
  function deduplicateRecords(records) {
    const seen = new Set();
    const unique = [];
    for (const r of records) {
      const roll = (r.rollNo || '').toUpperCase();
      if (!seen.has(roll)) {
        seen.add(roll);
        unique.push(r);
      }
    }
    return unique;
  }

  /**
   * Export attendance data as CSV for Google Sheets / Microsoft Excel
   */
  function exportCSV(filtered = null, options = {}) {
    let dataToExport = filtered || logs;
    if (typeof options === 'boolean') {
      if (options) dataToExport = deduplicateRecords(dataToExport);
    } else if (options && options.uniqueOnly) {
      dataToExport = deduplicateRecords(dataToExport);
    }

    if (dataToExport.length === 0) {
      throw new Error('No attendance records available to export.');
    }

    const headers = ['Roll Number', 'Student Name', 'Branch', 'Year', 'Date', 'Time', 'Session', 'Status', 'Marked By'];
    const rows = dataToExport.map(r => [
      `"${r.rollNo}"`,
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.branch || '').replace(/"/g, '""')}"`,
      `"${r.year || ''}"`,
      `"${r.date || ''}"`,
      `"${r.timestamp || ''}"`,
      `"${(r.session || '').replace(/"/g, '""')}"`,
      `"${r.status || 'Present'}"`,
      `"${(r.markedBy || 'Staff Member').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const filename = (options && options.filename) || `Smart_Attendance_Report_${getTodayDateStr()}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return filename;
  }

  /**
   * Export present attendance report as professional PDF using jsPDF + AutoTable
   */
  function exportPDF(filtered = null, options = {}) {
    let dataToExport = filtered || logs;
    if (options.uniqueOnly) {
      dataToExport = deduplicateRecords(dataToExport);
    }

    if (dataToExport.length === 0) {
      throw new Error('No attendance records available to export as PDF.');
    }

    const {
      title = 'PRESENT STUDENTS ATTENDANCE REPORT',
      dateStr = getTodayDateStr(),
      sessionName = 'All Sessions',
      filterDesc = 'All Records',
      includeSummary = true,
      adminName = (typeof AuthManager !== 'undefined' && AuthManager.getSession()?.displayName) || 'Administrator'
    } = options;

    // Check for jsPDF library
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      console.warn('jsPDF not available, falling back to print-to-PDF view.');
      printReport(dataToExport, options);
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    // 1. Top Decorative Brand Bar
    doc.setFillColor(15, 23, 42); // Deep Navy #0f172a
    doc.rect(0, 0, pageWidth, 7, 'F');
    doc.setFillColor(16, 185, 129); // Emerald Accent #10b981
    doc.rect(0, 7, pageWidth, 1.5, 'F');

    // 2. Header Title & Branding
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text('SMART ATTENDANCE SYSTEM', margin, 18);

    doc.setFontSize(11);
    doc.setTextColor(5, 150, 105); // Emerald green
    doc.text(title.toUpperCase(), margin, 24);

    // Metadata Right-Aligned
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const dateLabel = `Report Date: ${dateStr}`;
    const generatedLabel = `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const adminLabel = `Verified By: ${adminName}`;
    doc.text(dateLabel, pageWidth - margin, 17, { align: 'right' });
    doc.text(generatedLabel, pageWidth - margin, 22, { align: 'right' });
    doc.text(adminLabel, pageWidth - margin, 27, { align: 'right' });

    let currentY = 32;

    // 3. Filter Scope & Summary KPI Cards
    if (includeSummary) {
      const totalRegistered = (typeof RosterManager !== 'undefined') ? RosterManager.getAllStudents().length : 0;
      const totalPresent = dataToExport.length;
      const rate = totalRegistered > 0 ? Math.round((totalPresent / totalRegistered) * 100) : 'N/A';

      // KPI box container
      const cardWidth = (pageWidth - (margin * 2) - 8) / 3;
      const cardHeight = 16;

      // Card 1: Total Present
      doc.setFillColor(240, 253, 244); // light emerald #f0fdf4
      doc.setDrawColor(187, 247, 208);
      doc.roundedRect(margin, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(5, 150, 105);
      doc.text(String(totalPresent), margin + (cardWidth / 2), currentY + 7, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(22, 101, 52);
      doc.text('Present Attendees', margin + (cardWidth / 2), currentY + 12, { align: 'center' });

      // Card 2: Registered Whitelist
      const card2X = margin + cardWidth + 4;
      doc.setFillColor(240, 249, 255); // light cyan
      doc.setDrawColor(186, 230, 253);
      doc.roundedRect(card2X, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(2, 132, 199);
      doc.text(String(totalRegistered), card2X + (cardWidth / 2), currentY + 7, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(7, 89, 133);
      doc.text('Total Whitelisted', card2X + (cardWidth / 2), currentY + 12, { align: 'center' });

      // Card 3: Session / Turnout
      const card3X = card2X + cardWidth + 4;
      doc.setFillColor(248, 250, 252); // light slate
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(card3X, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(71, 85, 105);
      doc.text(typeof rate === 'number' ? `${rate}%` : sessionName, card3X + (cardWidth / 2), currentY + 7, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(typeof rate === 'number' ? 'Turnout Rate' : 'Academic Session', card3X + (cardWidth / 2), currentY + 12, { align: 'center' });

      currentY += 21;
    }

    // Filter subtitle info
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Active Session: ${sessionName}   |   Scope: ${filterDesc}   |   Attendees Count: ${dataToExport.length}`, margin, currentY);
    currentY += 4;

    // 4. Attendance Table via autoTable
    const tableColumns = [
      { header: '#', dataKey: 'index' },
      { header: 'Roll Number', dataKey: 'rollNo' },
      { header: 'Student Name', dataKey: 'name' },
      { header: 'Branch', dataKey: 'branch' },
      { header: 'Academic Year', dataKey: 'year' },
      { header: 'Time', dataKey: 'time' },
      { header: 'Session', dataKey: 'session' },
      { header: 'Status', dataKey: 'status' },
      { header: 'Verified By', dataKey: 'markedBy' }
    ];

    const tableRows = dataToExport.map((r, i) => ({
      index: i + 1,
      rollNo: r.rollNo,
      name: r.name,
      branch: r.branch,
      year: r.year,
      time: r.timestamp || '-',
      session: r.session || sessionName,
      status: 'PRESENT',
      markedBy: r.markedBy || 'Staff Member'
    }));

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        startY: currentY,
        columns: tableColumns,
        body: tableRows,
        margin: { left: margin, right: margin, bottom: 18 },
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 2.2,
          overflow: 'linebreak',
          font: 'helvetica'
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8.5,
          halign: 'left'
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 26, fontStyle: 'bold', textColor: [15, 23, 42] },
          2: { cellWidth: 32 },
          3: { cellWidth: 32 },
          4: { cellWidth: 24 },
          5: { cellWidth: 18, halign: 'center' },
          6: { cellWidth: 22 },
          7: { cellWidth: 18, halign: 'center', fontStyle: 'bold', textColor: [5, 150, 105] },
          8: { cellWidth: 'auto', textColor: [100, 116, 139] }
        },
        didDrawPage: function(data) {
          // Page footer
          const totalPages = doc.internal.getNumberOfPages();
          const currentPage = data.pageNumber;
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184);
          
          doc.text('Smart Attendance System • Official Academic Record • Confidential', margin, pageHeight - 8);
          doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
        }
      });
    }

    const cleanDate = dateStr.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Present_Students_Report_${cleanDate}.pdf`;
    doc.save(filename);
    return filename;
  }

  /**
   * Browser Print Report Fallback (Print to PDF)
   */
  function printReport(filtered = null, options = {}) {
    let dataToExport = filtered || logs;
    if (options.uniqueOnly) {
      dataToExport = deduplicateRecords(dataToExport);
    }
    if (dataToExport.length === 0) {
      throw new Error('No attendance records available to print.');
    }

    const {
      title = 'Present Students Attendance Report',
      dateStr = getTodayDateStr(),
      sessionName = 'All Sessions',
      adminName = (typeof AuthManager !== 'undefined' && AuthManager.getSession()?.displayName) || 'Administrator'
    } = options;

    const printWin = window.open('', '_blank');
    if (!printWin) {
      throw new Error('Popup blocked. Please allow popups to preview report.');
    }

    const rowsHtml = dataToExport.map((r, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td><strong>${r.rollNo}</strong></td>
        <td>${r.name}</td>
        <td>${r.branch}</td>
        <td>${r.year}</td>
        <td style="text-align:center;">${r.timestamp || '-'}</td>
        <td>${r.session || sessionName}</td>
        <td style="text-align:center; color:#059669; font-weight:bold;">PRESENT</td>
        <td>${r.markedBy || 'Staff Member'}</td>
      </tr>
    `).join('');

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title} - ${dateStr}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 24px; }
          .header { border-bottom: 3px solid #10b981; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
          .title { font-size: 20px; font-weight: bold; color: #0f172a; margin: 0; }
          .subtitle { font-size: 13px; color: #059669; font-weight: 600; margin-top: 4px; }
          .meta { font-size: 11px; color: #64748b; text-align: right; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
          .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: center; }
          .summary-card .num { font-size: 18px; font-weight: bold; color: #059669; }
          .summary-card .lbl { font-size: 11px; color: #64748b; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px; }
          th { background: #0f172a; color: #fff; text-align: left; padding: 8px 6px; border: 1px solid #0f172a; }
          td { padding: 6px; border: 1px solid #cbd5e1; }
          tr:nth-child(even) { background: #f8fafc; }
          .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          @media print {
            body { margin: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="title">SMART ATTENDANCE SYSTEM</h1>
            <div class="subtitle">${title.toUpperCase()}</div>
          </div>
          <div class="meta">
            <div>Date: <strong>${dateStr}</strong></div>
            <div>Session: <strong>${sessionName}</strong></div>
            <div>Verified by: <strong>${adminName}</strong></div>
          </div>
        </div>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="num">${dataToExport.length}</div>
            <div class="lbl">Present Students</div>
          </div>
          <div class="summary-card">
            <div class="num">${(typeof RosterManager !== 'undefined') ? RosterManager.getAllStudents().length : '-'}</div>
            <div class="lbl">Total Registered</div>
          </div>
          <div class="summary-card">
            <div class="num">${sessionName}</div>
            <div class="lbl">Active Session</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:30px; text-align:center;">#</th>
              <th>Roll Number</th>
              <th>Student Name</th>
              <th>Branch</th>
              <th>Year</th>
              <th style="text-align:center;">Time</th>
              <th>Session</th>
              <th style="text-align:center;">Status</th>
              <th>Verified By</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <div class="footer">
          <span>Smart Attendance System • Official Academic Attendance Record</span>
          <span>Verified By Administrator: ___________________________</span>
        </div>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
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
    syncFromServer,
    getAllLogs: () => [...logs],
    getFilteredLogs,
    isAlreadyMarked,
    recordAttendance,
    deleteRecord,
    removeAttendanceForStudent,
    clearAllLogs,
    getMetrics,
    exportCSV,
    exportPDF,
    printReport,
    deduplicateRecords,
    renderCharts,
    getTodayDateStr
  };
})();
