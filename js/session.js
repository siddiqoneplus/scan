/**
 * SESSION MANAGER MODULE
 * Handles Active Attendance Session
 */

const SessionManager = (() => {
  let activeSession = null;
  let sessionLogs = [];
  let totalStudents = 0;
  
  function getActiveSession() {
    return activeSession;
  }
  
  async function startSession() {
    const subject = document.getElementById('sessionInputSubject').value.trim();
    const section = document.getElementById('sessionInputSection').value.trim();
    const period = document.getElementById('sessionInputPeriod').value.trim();
    
    if (!subject || !section || !period) {
      showToast('Please fill all session fields', 'warning');
      return;
    }
    
    try {
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
        },
        body: JSON.stringify({ subject, section, period })
      });
      const data = await res.json();
      if (data.success) {
        activeSession = data.session;
        sessionLogs = [];
        
        // Calculate total students for this section
        totalStudents = 0;
        if (typeof RosterManager !== 'undefined') {
          const students = RosterManager.getStudents();
          totalStudents = students.filter(s => s.section && s.section.toUpperCase() === section.toUpperCase()).length;
        }
        
        updateUI();
        showToast('Session Started!', 'success');
        
        // Unlock scanner
        document.getElementById('sessionInactiveOverlay').style.display = 'none';
        document.getElementById('scanFrameOverlay').style.display = 'block';
      } else {
        showToast(data.error || 'Failed to start session', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
  }
  
  async function stopSession() {
    if (!activeSession) return;
    
    try {
      const res = await fetch('/api/sessions/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
        },
        body: JSON.stringify({ sessionId: activeSession.sessionId })
      });
      const data = await res.json();
      if (data.success) {
        activeSession = null;
        updateUI();
        showToast('Session Stopped', 'success');
        
        // Lock scanner
        document.getElementById('sessionInactiveOverlay').style.display = 'flex';
        document.getElementById('scanFrameOverlay').style.display = 'none';
      } else {
        showToast(data.error || 'Failed to stop session', 'error');
      }
    } catch (e) {
      showToast('Network error', 'error');
    }
  }
  
  function recordScanned(studentName) {
    if (!activeSession) return;
    sessionLogs.push(studentName);
    updateUI();
  }
  
  function updateUI() {
    const setupDiv = document.getElementById('sessionSetup');
    const activeDiv = document.getElementById('sessionActive');
    
    if (activeSession) {
      setupDiv.style.display = 'none';
      activeDiv.style.display = 'block';
      
      document.getElementById('activeSessionTitle').innerText = `${activeSession.subject} (Sec ${activeSession.section}) - Period ${activeSession.period}`;
      document.getElementById('activeSessionPresent').innerText = sessionLogs.length;
      document.getElementById('activeSessionTotal').innerText = totalStudents;
      
      const remaining = Math.max(0, totalStudents - sessionLogs.length);
      document.getElementById('activeSessionRemaining').innerText = remaining;
      
      document.getElementById('activeSessionLastScanned').innerText = sessionLogs.length > 0 ? sessionLogs[sessionLogs.length - 1] : 'None';
    } else {
      setupDiv.style.display = 'block';
      activeDiv.style.display = 'none';
    }
  }
  
  return {
    getActiveSession,
    startSession,
    stopSession,
    recordScanned,
    updateUI
  };
})();
