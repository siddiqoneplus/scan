const fs = require('fs');

let scanner = fs.readFileSync('js/scanner.js', 'utf8');

const processSecureScanRegex = /async function processSecureScan\(qrPayload\) \{[\s\S]*?\} catch \(e\) \{[\s\S]*?\}\s*\}/;

const newProcessSecureScan = `
  async function processSecureScan(qrPayload) {
    const activeSession = typeof SessionManager !== 'undefined' ? SessionManager.getActiveSession() : null;
    if (!activeSession) {
      playSound('error');
      showResultBanner({
        type: 'error',
        title: 'NO ACTIVE SESSION',
        message: 'You must start an attendance session before scanning.',
        rollNo: 'Unknown'
      });
      return;
    }
    
    const sessionId = activeSession.sessionId;

    try {
      const res = await fetch('/api/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload, session: sessionId })
      });
      
      const data = await res.json();
      const student = data.student || null;
      const rollNo = student ? student.rollNo : (data.rollNo || 'Unknown');

      if (res.ok && data.success) {
        playSound('success');

        if (typeof SessionManager !== 'undefined') {
           SessionManager.recordScanned(student ? student.name : rollNo);
        }

        showResultBanner({
          type: 'success',
          title: 'ATTENDANCE CONFIRMED',
          message: 'Attendance verified and saved securely.',
          rollNo: rollNo,
          student: student,
          record: data.record
        });
        
        if (typeof App !== 'undefined') App.showToast(\`Marked Present: \${student ? student.name : rollNo}\`, 'success');
        deferRefresh();
        requestAnimationFrame(() => triggerConfetti());
      } else {
        const errorMsg = data.error || 'Failed to process QR code.';
        let type = 'error';
        let title = 'SCAN FAILED';
        
        if (data.reason === 'duplicate scan' || errorMsg.toLowerCase().includes('already marked')) {
           type = 'warning';
           title = 'ALREADY MARKED PRESENT';
        } else if (errorMsg.toLowerCase().includes('not found')) {
           title = 'STUDENT NOT FOUND';
        } else if (errorMsg.toLowerCase().includes('inactive')) {
           title = 'STUDENT INACTIVE';
        } else if (errorMsg.toLowerCase().includes('unauthorized')) {
           title = 'UNAUTHORIZED';
        } else if (errorMsg.toLowerCase().includes('does not match section')) {
           title = 'WRONG SECTION';
        } else if (errorMsg.toLowerCase().includes('session')) {
           title = 'INVALID SESSION';
        } else if (errorMsg.toLowerCase().includes('invalid')) {
           title = 'INVALID QR';
        }

        playSound(type === 'warning' ? 'warning' : 'error');
        showResultBanner({
          type,
          title,
          message: errorMsg,
          rollNo: rollNo,
          student: student,
          record: data.record
        });
      }
    } catch (e) {
      playSound('error');
      showResultBanner({
        type: 'error',
        title: 'NETWORK FAILURE',
        message: 'Could not communicate with the server. Check your connection.',
        rollNo: 'Unknown'
      });
    }
  }
`;

scanner = scanner.replace(processSecureScanRegex, newProcessSecureScan.trim());

// We also need to fix `updateStatus` for "Camera loading" and "Camera permission denied"
// Actually html5QrCode handles camera errors nicely, but we can hook into `startCamera`
const startCameraRegex = /async function startCamera\(\) \{[\s\S]*?catch \(err\) \{[\s\S]*?\}/;
const newStartCamera = `
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

      updateStatus('Camera loading...', 'warning');
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        updateStatus('No camera found on this device', 'error');
        return;
      }

      const cameraId = cameras[0].id;
      currentCameraId = cameraId;

      await html5QrCode.start(
        cameraId,
        {
          fps: 15,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
          disableFlip: false
        },
        handleScanSuccess,
        undefined
      );

      isScanning = true;
      document.getElementById('reader').classList.add('scanning-active');
      
      updateStatus('Scanner ready. Position QR code in frame.', 'success');
      
      const btn = document.getElementById('btnToggleCamera');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-camera-slash"></i> Stop Camera';

    } catch (err) {
      console.warn('Camera start error:', err);
      if (err.name === 'NotAllowedError' || (typeof err === 'string' && err.includes('permission'))) {
        updateStatus('Camera permission denied. Please allow camera access.', 'error');
      } else {
        updateStatus('Camera failed to start: ' + (err.message || err), 'error');
      }
      isScanning = false;
    }
`;

scanner = scanner.replace(startCameraRegex, newStartCamera.trim());
fs.writeFileSync('js/scanner.js', scanner);
