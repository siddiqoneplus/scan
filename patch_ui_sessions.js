const fs = require('fs');

let content = fs.readFileSync('index.html', 'utf8');

const sessionPanel = `
          <!-- Attendance Session Control Panel -->
          <div class="scanner-feed-card mb-3" id="sessionControlCard">
            <div class="feed-header" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 15px;">
              <h3 class="feed-title"><i class="fa-solid fa-clock"></i> Attendance Session</h3>
            </div>
            
            <div id="sessionSetup">
               <div class="form-group">
                 <label>Subject</label>
                 <input type="text" id="sessionInputSubject" class="input-styled" placeholder="e.g. Data Structures" required>
               </div>
               <div class="form-group">
                 <label>Section</label>
                 <input type="text" id="sessionInputSection" class="input-styled" placeholder="e.g. A" required>
               </div>
               <div class="form-group">
                 <label>Period</label>
                 <input type="text" id="sessionInputPeriod" class="input-styled" placeholder="e.g. 1" required>
               </div>
               <button class="btn btn-primary w-100 mt-2" onclick="SessionManager.startSession()">
                 <i class="fa-solid fa-play"></i> START ATTENDANCE
               </button>
            </div>
            
            <div id="sessionActive" style="display:none;">
               <div style="background: rgba(46, 213, 115, 0.1); border: 1px solid var(--accent-success); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                  <h4 id="activeSessionTitle" style="margin-top:0; color: var(--accent-success); font-size: 1.1rem; margin-bottom: 10px;">Subject (Sec) - Period</h4>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                     <span class="text-muted">Present:</span>
                     <strong><span id="activeSessionPresent">0</span> / <span id="activeSessionTotal">0</span></strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                     <span class="text-muted">Remaining:</span>
                     <strong id="activeSessionRemaining">0</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                     <span class="text-muted">Last Scanned:</span>
                     <strong id="activeSessionLastScanned" style="color:var(--text-main);">None</strong>
                  </div>
               </div>
               <button class="btn btn-danger w-100" onclick="SessionManager.stopSession()">
                 <i class="fa-solid fa-stop"></i> STOP ATTENDANCE
               </button>
            </div>
          </div>
`;

content = content.replace('<!-- Scan Result Notification Card -->', sessionPanel + '\n          <!-- Scan Result Notification Card -->');

const scanOverlay = `
            <div class="scan-overlay" id="sessionInactiveOverlay" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10;">
              <i class="fa-solid fa-lock" style="font-size: 3rem; color: #ff4757; margin-bottom: 15px;"></i>
              <h3 style="color: white; margin: 0;">Scanner Locked</h3>
              <p style="color: #a4b0be; margin-top: 5px;">Start an attendance session to unlock</p>
            </div>
`;

content = content.replace('<div class="scan-overlay">', scanOverlay + '\n            <div class="scan-overlay" id="scanFrameOverlay">');

fs.writeFileSync('index.html', content);
