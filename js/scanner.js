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
   * Main roll number validation and attendance registration pipeline
   */
  function processRollNumber(inputRollNumber) {
    const activeSession = document.getElementById('activeSessionSelect')?.value || 'Morning Lecture';
    
    // Normalize roll number: extract roll number if text contains JSON or URL or prefix
    let rollNo = inputRollNumber.trim().toUpperCase();

    // If QR contains JSON like {"rollNo": "21B91A0501"}
    if (rollNo.startsWith('{') && rollNo.endsWith('}')) {
      try {
        const parsed = JSON.parse(rollNo);
        rollNo = (parsed.rollNo || parsed.roll || parsed.id || rollNo).trim().toUpperCase();
      } catch (e) {
        // Not valid JSON, keep as is
      }
    }

    // If QR contains a URL with roll number parameter
    if (rollNo.includes('?roll=')) {
      try {
        const url = new URL(rollNo);
        rollNo = (url.searchParams.get('roll') || rollNo).trim().toUpperCase();
      } catch (e) {}
    }

    // 1. Check if the Roll Number is Whitelisted/Assigned by Admin
    const student = RosterManager.findStudent(rollNo);

    if (!student) {
      // REJECT: Not registered by admin
      playSound('error');
      showResultBanner({
        type: 'error',
        title: 'UNAUTHORIZED ROLL NUMBER',
        message: `Roll Number "${rollNo}" is NOT assigned by Admin. Unregistered QR codes cannot mark attendance.`,
        rollNo: rollNo,
        student: null
      });
      App.showToast(`Rejected: Roll Number ${rollNo} not found in Admin list`, 'error');
      return;
    }

    // Check if assigned to current employee (if logged in as employee)
    const currentSession = (typeof AuthManager !== 'undefined') ? AuthManager.getSession() : null;
    if (currentSession && currentSession.role === 'employee') {
      const isAssigned = RosterManager.isRollNumberAssigned(rollNo, currentSession.username, currentSession.role);
      if (!isAssigned) {
        playSound('error');
        showResultBanner({
          type: 'error',
          title: 'STUDENT NOT ASSIGNED TO YOU',
          message: `Student "${student.name}" (${rollNo}) is in the university whitelist but assigned to another staff member.`,
          rollNo: rollNo,
          student: student
        });
        App.showToast(`Access Restricted: Student not assigned to your staff account`, 'error');
        return;
      }
    }

    // 2. Check if already marked present today for this session
    if (AttendanceManager.isAlreadyMarked(rollNo, activeSession)) {
      playSound('warning');
      showResultBanner({
        type: 'warning',
        title: 'ALREADY MARKED TODAY',
        message: `${student.name} (${student.rollNo}) has already checked in for "${activeSession}".`,
        rollNo: rollNo,
        student: student
      });
      App.showToast(`Already Marked: ${student.name} is present`, 'warning');
      return;
    }

    // 3. Mark Attendance Successfully!
    const recordResult = AttendanceManager.recordAttendance(student, activeSession);

    if (recordResult.success) {
      playSound('success');
      showResultBanner({
        type: 'success',
        title: 'ATTENDANCE CONFIRMED',
        message: `Attendance recorded successfully for ${activeSession}!`,
        rollNo: rollNo,
        student: student,
        record: recordResult.record
      });
      App.showToast(`Marked Present: ${student.name} (${student.branch})`, 'success');
      // Defer heavy DOM refreshes & confetti so they don't block the camera decode loop
      deferRefresh();
      requestAnimationFrame(() => triggerConfetti());
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
              ${record ? `<span class="tag tag-session">${escapeHtml(record.timestamp)}</span>` : ''}
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
