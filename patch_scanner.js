const fs = require('fs');

let scanner = fs.readFileSync('js/scanner.js', 'utf8');

// We are going to replace processSecureScan entirely.
const processSecureScanStart = "  async function processSecureScan(qrPayload) {";
const processSecureScanEnd = "    } catch (e) {";

// Oh, actually regex or string replacement is tricky because it has many lines.
// Let's replace the whole function using substring.

const newProcessSecureScan = `  let isScanningInProgress = false;

  async function processSecureScan(qrPayload, isRetry = false) {
    if (isScanningInProgress) {
        if (!isRetry) showResultBanner({ type: 'warning', title: 'PLEASE WAIT', message: 'Currently confirming previous scan with server...', rollNo: 'Wait' });
        return;
    }
    
    const activeSession = typeof SessionManager !== 'undefined' ? SessionManager.getActiveSession() : null;
    if (!activeSession) {
      playSound('error');
      showResultBanner({ type: 'error', title: 'NO ACTIVE SESSION', message: 'You must start an attendance session before scanning.', rollNo: 'Unknown' });
      return;
    }
    
    const sessionId = activeSession.sessionId;
    isScanningInProgress = true;
    updateStatus('Connecting to server...', 'warning');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second strict timeout
      
      const res = await fetch('/api/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload, session: sessionId }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const data = await res.json();
      isScanningInProgress = false;
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
          message: 'Attendance verified and securely recorded by server.',
          rollNo: rollNo,
          student: student,
          record: data.record
        });
        
        if (typeof App !== 'undefined') App.showToast(\`Marked Present: \${student ? student.name : rollNo}\`, 'success');
        deferRefresh();
        requestAnimationFrame(() => triggerConfetti());
        updateStatus('Ready (Online)', 'active');
      } else {
        const errorMsg = data.error || 'Failed to process QR code.';
        let type = 'error';
        let title = 'SCAN FAILED';
        
        if (data.reason === 'duplicate scan' || errorMsg.toLowerCase().includes('already marked') || errorMsg.toLowerCase().includes('duplicate')) {
           type = 'warning';
           title = 'ALREADY MARKED PRESENT';
        } else if (errorMsg.toLowerCase().includes('not found')) {
           title = 'STUDENT NOT FOUND';
        } else if (errorMsg.toLowerCase().includes('inactive')) {
           title = 'STUDENT INACTIVE';
        } else if (errorMsg.toLowerCase().includes('unauthorized') || errorMsg.toLowerCase().includes('permission')) {
           title = 'UNAUTHORIZED';
        } else if (errorMsg.toLowerCase().includes('section')) {
           title = 'WRONG SECTION';
        } else if (errorMsg.toLowerCase().includes('session')) {
           title = 'INVALID SESSION';
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
        updateStatus('Ready (Online)', 'active');
      }
    } catch (e) {
      isScanningInProgress = false;
      playSound('error');
      
      const isTimeout = e.name === 'AbortError' || e.message.includes('abort');
      
      showResultBanner({
        type: 'error',
        title: isTimeout ? 'CONNECTION TIMEOUT' : 'NETWORK FAILURE',
        message: isTimeout ? 'Server took too long to respond. Attendance was NOT confirmed.' : 'Could not communicate with the server. Attendance was NOT confirmed.',
        rollNo: 'Unknown',
        retryPayload: qrPayload
      });
      updateStatus('Offline / Unstable', 'error');
    }
  }`;


const newShowResultBanner = `  function showResultBanner({ type, title, message, rollNo, student, record, retryPayload }) {
    const banner = document.getElementById('scanResultBanner');
    if (!banner) return;

    banner.className = \`result-banner \${type}\`;
    
    let iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-xmark';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    let studentDetailsHtml = '';
    if (student) {
      studentDetailsHtml = \`
        <div class="student-card-preview">
          <div class="student-avatar \${type}">
            \${student.name.charAt(0)}
          </div>
          <div class="student-info">
            <h4>\${escapeHtml(student.name)}</h4>
            <div class="roll-no">\${escapeHtml(student.rollNo)}</div>
            <div class="student-badges">
              <span class="tag tag-branch">\${escapeHtml(student.branch.split('(')[0] || student.branch)}</span>
              <span class="tag tag-year">\${escapeHtml(student.year)}</span>
              \${student.section ? \`<span class="tag tag-section">Sec \${escapeHtml(student.section)}</span>\` : ''}
              \${record ? \`<span class="tag tag-session"><i class="fa-solid fa-clock"></i> \${escapeHtml(record.timestamp)}</span>\` : ''}
            </div>
          </div>
        </div>
      \`;
    } else if (rollNo !== 'Unknown' && rollNo !== 'Wait') {
      studentDetailsHtml = \`
        <div class="student-card-preview">
          <div class="student-avatar error">
            <i class="fa-solid fa-user-slash"></i>
          </div>
          <div class="student-info">
            <h4>Unregistered / Unknown</h4>
            <div class="roll-no">\${escapeHtml(rollNo)}</div>
          </div>
        </div>
      \`;
    }
    
    let retryHtml = '';
    if (retryPayload) {
       // Attach retry payload globally so inline handler can use it
       window.__lastFailedPayload = retryPayload;
       retryHtml = \`<button class="btn btn-primary mt-3" style="width:100%" onclick="QRScanner.retryScan(window.__lastFailedPayload)"><i class="fa-solid fa-rotate-right"></i> Retry Connection</button>\`;
    }

    banner.innerHTML = \`
      <div class="result-header">
        <i class="fa-solid \${iconClass}"></i>
        <span>\${title}</span>
      </div>
      <p class="result-desc">\${escapeHtml(message)}</p>
      \${studentDetailsHtml}
      \${retryHtml}
    \`;

    banner.style.display = 'block';
  }`;


function replaceBlock(str, startMarker, endMarker, replacement) {
    const startIdx = str.indexOf(startMarker);
    if (startIdx === -1) return str;
    
    let openBraces = 0;
    let endIdx = -1;
    
    let i = startIdx + startMarker.indexOf('{');
    if (startMarker.indexOf('{') === -1) {
       // find first brace after startMarker
       i = startIdx + startMarker.length;
       while(str[i] !== '{' && i < str.length) i++;
    }
    
    openBraces = 1;
    i++;
    
    while(i < str.length && openBraces > 0) {
        if(str[i] === '{') openBraces++;
        if(str[i] === '}') openBraces--;
        i++;
    }
    
    endIdx = i;
    
    const before = str.substring(0, startIdx);
    const after = str.substring(endIdx);
    return before + replacement + after;
}

let patched = replaceBlock(scanner, "async function processSecureScan(qrPayload) {", "}", newProcessSecureScan);
patched = replaceBlock(patched, "function showResultBanner({ type, title, message, rollNo, student, record }) {", "}", newShowResultBanner);

// Add retryScan function export
if (!patched.includes('retryScan: processSecureScan')) {
    patched = patched.replace('stopScan,', 'stopScan,\n    retryScan: processSecureScan,');
}

fs.writeFileSync('js/scanner.js', patched);
console.log('Patched scanner.js for network resilience');
