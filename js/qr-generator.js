/**
 * STUDENT QR CODE & ID BADGE GENERATOR
 * Generates crisp QR codes for all students, powers the ID badge studio,
 * and facilitates batch printing and image downloading.
 */

const QRStudio = (() => {
  let activeFilterBranch = 'ALL';
  let activeFilterYear = 'ALL';
  let secureTokens = {};

  async function fetchSecureTokens() {
    try {
      const res = await fetch('/api/roster/qr-tokens');
      const data = await res.json();
      if (data.success) {
        secureTokens = data.tokens;
      }
    } catch (e) {
      console.warn("Failed to fetch secure QR tokens", e);
    }
  }


  function generateCardHTML(student, mode = 'studio', customIndex = 0) {
    const qrBoxId = mode === 'single' ? `qr-box-single-${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}` : `qr-box-${customIndex}-${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}`;
    
    const actionsHtml = mode === 'studio' ? `
        <div class="id-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="QRStudio.downloadQR('${student.rollNo}', '${escapeHtml(student.name)}')">
            <i class="fa-solid fa-download"></i> Save QR
          </button>
          <button class="btn btn-primary btn-sm" onclick="App.openViewQR('${student.rollNo}')">
            <i class="fa-solid fa-id-card"></i> View Card
          </button>
        </div>` : '';

    return `
      <div class="id-card" style="${mode === 'single' ? 'margin: 0; box-shadow: none;' : ''}">
        <div class="id-card-college">
          <i class="fa-solid fa-building-columns"></i> Smart Attendance System
        </div>
        <div class="id-card-qr-box" id="${qrBoxId}"></div>
        <div class="id-card-name">${escapeHtml(student.name)}</div>
        <div class="id-card-roll">${escapeHtml(student.rollNo)}</div>
        <div class="id-card-badges">
          <span class="tag tag-branch">${escapeHtml(student.branch)}</span>
          <span class="tag tag-year">${escapeHtml(student.year)}</span>
          <span class="tag tag-section">${escapeHtml(student.section || '—')}</span>
        </div>
        ${actionsHtml}
      </div>
    `;
  }
  
  function getSecurePayload(rollNo) {
     return secureTokens[rollNo] || rollNo;
  }

  async function renderStudentBadges() {
    await fetchSecureTokens();
    const container = document.getElementById('cardsContainer');
    if (!container) return;

    let students = RosterManager.getAllStudents();

    if (activeFilterBranch !== 'ALL') {
      students = students.filter(s => s.branch === activeFilterBranch || s.branch.includes(activeFilterBranch) || activeFilterBranch.includes(s.branch));
    }
    if (activeFilterYear !== 'ALL') {
      students = students.filter(s => s.year === activeFilterYear || s.year.includes(activeFilterYear) || activeFilterYear.includes(s.year));
    }

    if (students.length === 0) {
      container.innerHTML = `
        <div class="empty-placeholder cards-empty">
          <i class="fa-solid fa-id-card-clip"></i>
          <p>No student records found matching the current filters.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    students.forEach((student, index) => {
      const card = document.createElement('div');
      card.className = 'id-card';
      const qrBoxId = `qr-box-${index}-${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}`;

      const qrBoxId = `qr-box-${index}-${student.rollNo.replace(/[^a-zA-Z0-9]/g, '')}`;
      card.innerHTML = generateCardHTML(student, 'studio', index);

      container.appendChild(card);

      // Render QR inside qrBox using secure token instead of raw roll number
      setTimeout(() => {
        const payload = secureTokens[student.rollNo] || student.rollNo;
        generateQRCode(qrBoxId, payload);
      }, 50);
    });
  }

  function generateQRCode(elementId, text) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(el, {
          text: text,
          width: 140,
          height: 140,
          colorDark: '#0a0d14',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
        return;
      } catch (e) {
        console.warn('QRCode library error, using fallback image', e);
      }
    }

    // High quality fallback using Google Chart API or QR Server
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(text)}&margin=10`;
    img.alt = `QR Code for ${text}`;
    img.className = 'qr-code-img';
    el.appendChild(img);
  }

  function downloadQR(rollNo, studentName) {
    const cleanRoll = rollNo.replace(/[^a-zA-Z0-9]/g, '');
    const filename = `QR_${cleanRoll}_${studentName.replace(/\s+/g, '_')}.png`;

    // Try finding the existing rendered canvas inside the ID card
    const existingBoxes = document.querySelectorAll(`[id*="${cleanRoll}"] canvas`);
    if (existingBoxes.length > 0 && existingBoxes[0].toDataURL) {
      try {
        const dataUrl = existingBoxes[0].toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        App.showToast(`Downloaded QR for ${rollNo}`, 'success');
        return;
      } catch (e) {
        console.warn('Canvas export error, falling back', e);
      }
    }

    // Secondary fallback: generate using QRCode library on offscreen element
    try {
      const tempDiv = document.createElement('div');
      tempDiv.style.display = 'none';
      document.body.appendChild(tempDiv);
      new QRCode(tempDiv, {
        text: rollNo,
        width: 300,
        height: 300,
        correctLevel: QRCode.CorrectLevel.H
      });

      setTimeout(() => {
        const canvas = tempDiv.querySelector('canvas');
        if (canvas && canvas.toDataURL) {
          const a = document.createElement('a');
          a.href = canvas.toDataURL('image/png');
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          tempDiv.remove();
          App.showToast(`Downloaded QR for ${rollNo}`, 'success');
        } else {
          tempDiv.remove();
          // Tertiary fallback: remote API
          fetchDirectQr(secureTokens[rollNo] || rollNo, studentName, cleanRoll, filename);
        }
      }, 50);
      return;
    } catch (e) {
      fetchDirectQr(secureTokens[rollNo] || rollNo, studentName, cleanRoll, filename);
    }
  }

  function fetchDirectQr(payload, studentName, cleanRoll, filename) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(payload)}&margin=15`;
    fetch(qrUrl)
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showToast(`Downloaded QR for ${rollNo}`, 'success');
      })
      .catch(() => {
        window.open(qrUrl, '_blank');
      });
  }

  function setFilters(branch, year) {
    if (branch !== undefined) activeFilterBranch = branch;
    if (year !== undefined) activeFilterYear = year;
    renderStudentBadges();
  }

  function printAllBadges() {
    window.print();
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
    fetchSecureTokens,
    renderStudentBadges,
    generateQRCode,
    downloadQR,
    setFilters,
    printAllBadges,
    generateCardHTML,
    getSecurePayload
  };
})();
