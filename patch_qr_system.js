const fs = require('fs');

// 1. UPDATE index.html
let html = fs.readFileSync('index.html', 'utf8');

const oldModal = `  <!-- MODAL: VIEW QR -->
  <div class="modal-backdrop" id="modalViewQR">
    <div class="modal-box extract-style-1" >
      <div class="modal-header">
        <h3><i class="fa-solid fa-qrcode modal-icon-emerald"></i> Student QR Code</h3>
        <button type="button" class="btn btn-secondary btn-icon" onclick="App.closeModal('modalViewQR')">&times;</button>
      </div>
      <div class="modal-body">
        <h4 id="qrStudentName"  class="extract-style-2">Student Name</h4>
        <p id="qrStudentRoll" class="font-mono text-subtle extract-style-3" >ROLL NO</p>
        
        <div id="qrCodeContainer"  class="extract-style-4">
           <canvas id="qrCanvas"></canvas>
        </div>
        
        <div class="flex-gap extract-style-5" >
           <button class="btn btn-secondary" onclick="App.downloadQR()"><i class="fa-solid fa-download"></i> Download</button>
           <button class="btn btn-primary" onclick="App.printQR()"><i class="fa-solid fa-print"></i> Print</button>
        </div>
      </div>
    </div>
  </div>`;

const newModal = `  <!-- MODAL: VIEW QR ID CARD -->
  <div class="modal-backdrop" id="modalViewQR">
    <div class="modal-box" style="max-width: 420px;">
      <div class="modal-header">
        <h3><i class="fa-solid fa-id-card-clip modal-icon-emerald"></i> QR ID Card</h3>
        <button type="button" class="btn btn-secondary btn-icon" onclick="App.closeModal('modalViewQR')">&times;</button>
      </div>
      <div class="modal-body" style="background-color: var(--bg-primary); display: flex; flex-direction: column; align-items: center;">
        
        <div id="singleCardWrap" style="background: white; padding: 0.5rem; border-radius: 12px; margin-bottom: 1.5rem; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
           <!-- ID Card renders here -->
        </div>
        
        <div class="flex-gap w-full" style="justify-content: center;">
           <button class="btn btn-secondary" id="btnDownloadSingleQR"><i class="fa-solid fa-download"></i> Download Image</button>
           <button class="btn btn-primary" onclick="window.print()"><i class="fa-solid fa-print"></i> Print Card</button>
        </div>
      </div>
    </div>
  </div>`;

if (html.includes(oldModal)) {
    html = html.replace(oldModal, newModal);
    console.log("Patched index.html modal.");
} else {
    console.log("Could not find old modal in index.html.");
}
fs.writeFileSync('index.html', html);


// 2. UPDATE js/app.js
let app = fs.readFileSync('js/app.js', 'utf8');

// A. Add View QR Card button in roster table
const btnOld = `<button class="btn btn-secondary btn-sm" onclick="App.simulateScan('\${s.rollNo}')" title="Test QR Scan">
                <i class="fa-solid fa-barcode"></i>
              </button>`;
const btnNew = `<button class="btn btn-secondary btn-sm" onclick="App.openViewQR('\${s.rollNo}')" title="View QR Card">
                <i class="fa-solid fa-id-card"></i>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="App.simulateScan('\${s.rollNo}')" title="Test QR Scan">
                <i class="fa-solid fa-barcode"></i>
              </button>`;

if (app.includes(btnOld)) {
    app = app.replace(btnOld, btnNew);
    console.log("Patched app.js buttons.");
}

// B. Add openViewQR logic
const appAddLogic = `
  async function openViewQR(rollNo) {
    const students = RosterManager.getAllStudents();
    const student = students.find(s => s.rollNo === rollNo);
    if (!student) return showToast('Student not found.', 'error');
    
    openModal('modalViewQR');
    
    // Ensure tokens are loaded
    await QRStudio.fetchSecureTokens();
    const wrap = document.getElementById('singleCardWrap');
    wrap.innerHTML = QRStudio.generateCardHTML(student, 'single');
    
    // Render QR
    setTimeout(() => {
       QRStudio.generateQRCode(\`qr-box-single-\${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}\`, QRStudio.getSecurePayload(student.rollNo));
    }, 50);
    
    // Bind download
    document.getElementById('btnDownloadSingleQR').onclick = () => {
       QRStudio.downloadQR(student.rollNo, student.name);
    };
  }

  // EXPORT
`;

if (!app.includes('openViewQR(rollNo)')) {
    app = app.replace('  // --- EXPORTS ---', appAddLogic + '\n  // --- EXPORTS ---');
    app = app.replace('    simulateScan,', '    simulateScan,\n    openViewQR,');
    console.log("Patched app.js logic.");
}

fs.writeFileSync('js/app.js', app);


// 3. UPDATE js/qr-generator.js
let qrg = fs.readFileSync('js/qr-generator.js', 'utf8');

const qrgOldCard = `      card.innerHTML = \`
        <div class="id-card-college">
          <i class="fa-solid fa-graduation-cap"></i> University Student ID
        </div>
        <div class="id-card-qr-box" id="\${qrBoxId}"></div>
        <div class="id-card-name">\${escapeHtml(student.name)}</div>
        <div class="id-card-roll">\${escapeHtml(student.rollNo)}</div>
        <div class="id-card-badges">
          <span class="tag tag-branch">\${escapeHtml(student.branch.split('(')[1]?.replace(')', '') || student.branch)}</span>
          <span class="tag tag-year">\${escapeHtml(student.year)}</span>
        </div>
        <div class="id-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="QRStudio.downloadQR('\${student.rollNo}', '\${escapeHtml(student.name)}')">
            <i class="fa-solid fa-download"></i> Save QR
          </button>
          <button class="btn btn-primary btn-sm" onclick="App.simulateScan('\${student.rollNo}')">
            <i class="fa-solid fa-barcode"></i> Test Scan
          </button>
        </div>
      \`;`;

const qrgNewCardHtmlFunction = `
  function generateCardHTML(student, mode = 'studio', customIndex = 0) {
    const qrBoxId = mode === 'single' ? \`qr-box-single-\${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}\` : \`qr-box-\${customIndex}-\${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}\`;
    
    const actionsHtml = mode === 'studio' ? \`
        <div class="id-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="QRStudio.downloadQR('\${student.rollNo}', '\${escapeHtml(student.name)}')">
            <i class="fa-solid fa-download"></i> Save QR
          </button>
          <button class="btn btn-primary btn-sm" onclick="App.openViewQR('\${student.rollNo}')">
            <i class="fa-solid fa-id-card"></i> View Card
          </button>
        </div>\` : '';

    return \`
      <div class="id-card" style="\${mode === 'single' ? 'margin: 0; box-shadow: none;' : ''}">
        <div class="id-card-college">
          <i class="fa-solid fa-building-columns"></i> Smart Attendance System
        </div>
        <div class="id-card-qr-box" id="\${qrBoxId}"></div>
        <div class="id-card-name">\${escapeHtml(student.name)}</div>
        <div class="id-card-roll">\${escapeHtml(student.rollNo)}</div>
        <div class="id-card-badges">
          <span class="tag tag-branch">\${escapeHtml(student.branch)}</span>
          <span class="tag tag-year">\${escapeHtml(student.year)}</span>
          <span class="tag tag-section">\${escapeHtml(student.section || '—')}</span>
        </div>
        \${actionsHtml}
      </div>
    \`;
  }
  
  function getSecurePayload(rollNo) {
     return secureTokens[rollNo] || rollNo;
  }
`;

const qrgNewCardUsage = `      const qrBoxId = \`qr-box-\${index}-\${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}\`;
      card.innerHTML = generateCardHTML(student, 'studio', index);`;

if (qrg.includes(qrgOldCard)) {
    qrg = qrg.replace(qrgOldCard, qrgNewCardUsage);
    
    // Add the helper functions at the top of QRStudio
    const insertionPoint = `  async function renderStudentBadges() {`;
    qrg = qrg.replace(insertionPoint, qrgNewCardHtmlFunction + '\n' + insertionPoint);
    
    // Also update return object
    qrg = qrg.replace('    printAllBadges', '    printAllBadges,\n    generateCardHTML,\n    getSecurePayload');
    
    console.log("Patched qr-generator.js.");
}
fs.writeFileSync('js/qr-generator.js', qrg);

