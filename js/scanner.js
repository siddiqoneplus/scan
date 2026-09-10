/**
 * LIVE QR SCANNER ENGINE
 * Handles camera stream, video decoding, sound synthesis,
 * whitelist validation, duplicate checks, and visual feedback.
 */

const ScannerEngine = (() => {
  let html5QrCode = null;
  let isScanning = false;
  let currentCameraId = null;
  let lastScannedText = null;
  let lastScanTime = 0;
  const SCAN_COOLDOWN_MS = 2500; // Cooldown between scanning same code
  let soundEnabled = true;
  let refreshTimer = null; // debounce timer for heavy DOM refreshes

  // Web Audio Context for zero-latency synthesized sound effects
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      const now = audioCtx.currentTime;

      if (type === 'success') {
        // High-tech ascending two-tone chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'warning') {
        // Double blip
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'error') {
        // Low rejection buzz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      console.warn('Audio synthesis unavailable', e);
    }
  }

  async function startCamera() {
    initAudio();
    const readerElement = document.getElementById('reader');
    if (!readerElement) return;

    if (typeof Html5Qrcode === 'undefined') {
      updateStatus('Scanner library loading...', 'warning');
      return;
    }

    try {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode('reader');
      }

      if (isScanning) {
        return;
      }

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        updateStatus('No camera found on this device', 'error');
        return;
      }

      // Default to back camera on mobile or first camera on desktop
      const selectedCamera = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear')) || cameras[0];
      currentCameraId = selectedCamera.id;

      const config = {
        fps: 30,
        qrbox: { width: 200, height: 200 },
        disableFlip: true,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      };

      await html5QrCode.start(
        currentCameraId,
        config,
        (decodedText) => handleScanSuccess(decodedText),
        (errorMessage) => {
          // Continuous scanning ticks - ignore standard frame misses
        }
      );

      isScanning = true;
      updateStatus('Camera active. Align QR code within frame', 'success');
      document.getElementById('btnToggleCamera').innerHTML = '<i class="fa-solid fa-camera-rotate"></i> Stop Camera';
      document.getElementById('btnToggleCamera').classList.replace('btn-primary', 'btn-secondary');
    } catch (err) {
      console.error('Camera start error:', err);
      updateStatus('Camera access denied or unavailable. Use File Scan or Quick Simulator below.', 'error');
    }
  }

  async function stopCamera() {
    if (html5QrCode && isScanning) {
      try {
        await html5QrCode.stop();
        isScanning = false;
        updateStatus('Camera is paused', 'idle');
        document.getElementById('btnToggleCamera').innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        document.getElementById('btnToggleCamera').classList.replace('btn-secondary', 'btn-primary');
      } catch (err) {
        console.error('Failed to stop camera', err);
      }
    }
  }

  async function toggleCamera() {
    if (isScanning) {
      await stopCamera();
    } else {
      await startCamera();
    }
  }

  /**
   * Process a scanned or input string (QR code payload)
   */
  function handleScanSuccess(rawDecodedText) {
    if (!rawDecodedText) return;
    const cleanText = rawDecodedText.trim();
    const now = Date.now();

    // Check cooldown
    if (cleanText === lastScannedText && (now - lastScanTime) < SCAN_COOLDOWN_MS) {
      return;
    }

    lastScannedText = cleanText;
    lastScanTime = now;

    processRollNumber(cleanText);
  }

  /**
   * Parse arbitrary QR code content to extract roll number and metadata
   */
  function parseQrPayload(rawText) {
    if (!rawText) return { rollNo: '' };
    let text = rawText.trim();
    let rollNo = '';
    let parsedName = '';
    let parsedBranch = '';
    let parsedYear = '';
    let parsedSection = '';

    // Case 1: JSON payload
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        const obj = JSON.parse(text);
        const data = Array.isArray(obj) ? obj[0] : obj;
        if (data && typeof data === 'object') {
          rollNo = data.rollNo || data.roll_no || data.rollNumber || data.roll || 
                   data.id || data.studentId || data.student_id || data.regNo || 
                   data.reg_no || data.pin || data.code || '';
          parsedName = data.name || data.studentName || data.student_name || '';
          parsedBranch = data.branch || data.dept || data.department || '';
          parsedYear = data.year || data.batch || '';
          parsedSection = data.section || data.sec || data.division || data.div || '';
        }
      } catch (e) {}
    }

    // Case 2: URL with query parameters
    if (!rollNo && (text.includes('http://') || text.includes('https://') || text.includes('?'))) {
      try {
        const urlStr = text.startsWith('http') ? text : `http://localhost/${text}`;
        const url = new URL(urlStr);
        rollNo = url.searchParams.get('roll') || 
                 url.searchParams.get('rollNo') || 
                 url.searchParams.get('roll_no') || 
                 url.searchParams.get('id') || 
                 url.searchParams.get('studentId') || 
                 url.searchParams.get('code') || '';
        parsedName = url.searchParams.get('name') || '';
        parsedSection = url.searchParams.get('sec') || url.searchParams.get('section') || '';
      } catch (e) {}
    }

    // Case 3: Multiline or Key-Value text (e.g. "Roll No: 25A81A61B6\nName: John")
    if (!rollNo && text.includes('\n')) {
      const lines = text.split('\n');
      lines.forEach(line => {
        const parts = line.split(/[:=-]/);
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const val = parts.slice(1).join(':').trim();
          if (key.includes('roll') || key.includes('id') || key.includes('reg') || key.includes('pin')) {
            rollNo = val;
          } else if (key.includes('name')) {
            parsedName = val;
          } else if (key.includes('branch') || key.includes('dept')) {
            parsedBranch = val;
          } else if (key.includes('sec') || key.includes('div')) {
            parsedSection = val;
          }
        }
      });
    }

    // Case 4: Prefixed string like "ROLL: 24A81A4401" or "ID: 25A81A61B6"
    if (!rollNo) {
      const prefixMatch = text.match(/^(?:roll(?:\s*no)?|id|reg(?:\s*no)?|student(?:\s*id)?)\s*[:=-]?\s*(.+)$/i);
      if (prefixMatch) {
        rollNo = prefixMatch[1].trim();
      } else {
        rollNo = text;
      }
    }

    // Clean up roll number
    rollNo = (rollNo || '')
      .replace(/^["'`]|["'`]$/g, '') // remove surrounding quotes
      .replace(/[;,\.]+$/, '')       // remove trailing punctuation
      .trim()
      .toUpperCase();

    return {
      rollNo,
      name: parsedName.trim(),
      branch: parsedBranch.trim(),
      year: parsedYear.trim(),
      section: parsedSection.trim().toUpperCase()
    };
  }

  /**
   * Main roll number validation and attendance registration pipeline
   */
  function processRollNumber(inputRollNumber) {
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
    
    // Parse QR payload with maximum format flexibility
    const parsed = parseQrPayload(inputRollNumber);
    const rollNo = parsed.rollNo;

    if (!rollNo) {
      playSound('error');
      App.showToast('Invalid QR Code: Could not read student roll number', 'error');
      return;
    }

    // 1. Check if the Roll Number is in the Roster / Whitelist
    let student = RosterManager.findStudent(rollNo);

    // If student is NOT pre-registered in roster, AUTO-REGISTER so attendance is never rejected or lost!
    if (!student) {
      const classification = RosterManager.autoClassifyRollNumber(rollNo);
      const studentName = parsed.name || `Student ${rollNo}`;
      const studentBranch = parsed.branch || classification.branch;
      const studentYear = parsed.year || classification.year;
      const studentSection = parsed.section || '';

      try {
        student = RosterManager.addStudent({
          rollNo: rollNo,
          name: studentName,
          branch: studentBranch,
          year: studentYear,
          section: studentSection,
          assignedTo: 'all'
        });
        App.showToast(`Auto-registered: ${student.name} (${student.rollNo})`, 'info');
      } catch (e) {
        student = RosterManager.findStudent(rollNo) || {
          rollNo: rollNo,
          name: studentName,
          branch: studentBranch,
          year: studentYear,
          section: studentSection,
          assignedTo: 'all'
        };
      }
    } else {
      // If student was already in roster but QR code provides a section and roster had none, update section
      if (parsed.section && !student.section) {
        try {
          RosterManager.updateStudent(student.rollNo, { section: parsed.section });
          student.section = parsed.section;
        } catch (e) {}
      }
    }

    // Check if assigned to current employee (if logged in as employee)
    const currentSession = (typeof AuthManager !== 'undefined') ? AuthManager.getSession() : null;
    if (currentSession && currentSession.role === 'employee') {
      const isAssigned = RosterManager.isRollNumberAssigned(rollNo, currentSession.username, currentSession.role);
      if (!isAssigned) {
        // Automatically link student to 'all' so attendance can be taken without locking out staff
        try {
          RosterManager.updateStudent(rollNo, { assignedTo: 'all' });
        } catch (e) {}
      }
    }

    // 2. Check if already marked present today for this session
    if (AttendanceManager.isAlreadyMarked(rollNo, activeSession)) {
      playSound('warning');
      const allLogs = AttendanceManager.getAllLogs();
      const existing = allLogs.find(r => r.rollNo.toUpperCase() === rollNo.toUpperCase() && r.session === activeSession);
      showResultBanner({
        type: 'warning',
        title: 'ALREADY MARKED PRESENT',
        message: `${student.name} (${student.rollNo}) is already safely checked in for "${activeSession}" today at ${existing?.timestamp || 'earlier'}.`,
        rollNo: rollNo,
        student: student,
        record: existing
      });
      App.showToast(`Already Marked: ${student.name} is present`, 'warning');
      return;
    }

    // 3. Mark Attendance Successfully & Persist Immediately!
    const recordResult = AttendanceManager.recordAttendance(student, activeSession);

    if (recordResult.success) {
      playSound('success');
      showResultBanner({
        type: 'success',
        title: 'ATTENDANCE CONFIRMED & STORED',
        message: `Attendance saved to Database & Local Storage for ${activeSession}!`,
        rollNo: rollNo,
        student: student,
        record: recordResult.record
      });
      App.showToast(`Marked Present: ${student.name} (${student.branch})`, 'success');
      
      // Immediately refresh all views (KPIs, ticker, tables) on the spot!
      if (typeof App !== 'undefined' && App.refreshAllViews) {
        App.refreshAllViews();
      }
      requestAnimationFrame(() => triggerConfetti());
    } else {
      App.showToast(`Error: ${recordResult.reason || 'Could not record attendance'}`, 'error');
    }
  }

  function showResultBanner({ type, title, message, rollNo, student, record }) {
    const banner = document.getElementById('scanResultBanner');
    if (!banner) return;

    banner.className = `result-banner ${type}`;
    
    let iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-xmark';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    let studentDetailsHtml = '';
    if (student) {
      studentDetailsHtml = `
        <div class="student-card-preview">
          <div class="student-avatar ${type}">
            ${student.name.charAt(0)}
          </div>
          <div class="student-info">
            <h4>${escapeHtml(student.name)}</h4>
            <div class="roll-no">${escapeHtml(student.rollNo)}</div>
            <div class="student-badges">
              <span class="tag tag-branch">${escapeHtml(student.branch.split('(')[1]?.replace(')', '') || student.branch)}</span>
              <span class="tag tag-year">${escapeHtml(student.year)}</span>
              ${student.section ? `<span class="tag tag-section">Sec ${escapeHtml(student.section)}</span>` : ''}
              ${record ? `<span class="tag tag-session"><i class="fa-solid fa-clock"></i> ${escapeHtml(record.timestamp)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      studentDetailsHtml = `
        <div class="student-card-preview">
          <div class="student-avatar error">
            <i class="fa-solid fa-user-slash"></i>
          </div>
          <div class="student-info">
            <h4>Unregistered Student</h4>
            <div class="roll-no">${escapeHtml(rollNo)}</div>
            <div class="form-hint unregistered-hint">
              Admin must import or assign this roll number in Google Form / Roster tab.
            </div>
          </div>
        </div>
      `;
    }

    banner.innerHTML = `
      <div class="result-header">
        <i class="fa-solid ${iconClass}"></i>
        <span>${title}</span>
      </div>
      <p class="result-desc">${escapeHtml(message)}</p>
      ${studentDetailsHtml}
    `;

    banner.style.display = 'block';
  }

  function updateStatus(text, state) {
    const pill = document.getElementById('scanStatusPill');
    if (!pill) return;

    const stateClass = state ? ` ${state}` : '';

    pill.innerHTML = `
      <span class="status-dot${stateClass}"></span>
      <span>${escapeHtml(text)}</span>
    `;
  }

  /**
   * Scan QR Code from uploaded image file
   */
  async function scanFromFile(file) {
    if (!file) return;
    initAudio();
    updateStatus('Analyzing uploaded QR image...', 'warning');

    try {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode('reader');
      }
      const decoded = await html5QrCode.scanFile(file, true);
      handleScanSuccess(decoded);
      updateStatus('QR Code successfully decoded from file!', 'success');
    } catch (err) {
      console.error('File scan error:', err);
      updateStatus('Could not detect a valid QR code in the image', 'error');
      App.showToast('No valid QR code found in uploaded image', 'error');
    }
  }

  function triggerConfetti() {
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 30,
        spread: 50,
        origin: { y: 0.7 },
        colors: ['#10b981', '#06b6d4', '#3b82f6'],
        disableForReducedMotion: true
      });
    }
  }

  /**
   * Debounced refresh – collapses rapid successive scans into one DOM update
   * so the camera feed stays smooth.
   */
  function deferRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (typeof App !== 'undefined' && App.refreshAllViews) {
        App.refreshAllViews();
      }
      refreshTimer = null;
    }, 300);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btnToggleSound');
    if (btn) {
      btn.innerHTML = soundEnabled 
        ? '<i class="fa-solid fa-volume-high"></i>' 
        : '<i class="fa-solid fa-volume-xmark"></i>';
      btn.title = soundEnabled ? 'Mute Sound' : 'Unmute Sound';
    }
    App.showToast(soundEnabled ? 'Scanner Audio Enabled' : 'Scanner Audio Muted', 'info');
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  return {
    startCamera,
    stopCamera,
    toggleCamera,
    processRollNumber,
    scanFromFile,
    toggleSound,
    updateStatus
  };
})();
