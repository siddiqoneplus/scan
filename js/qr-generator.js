/**
 * STUDENT QR CODE & ID BADGE GENERATOR
 * Generates crisp QR codes for all students, powers the ID badge studio,
 * and facilitates batch printing and image downloading.
 */

const QRStudio = (() => {
  let activeFilterBranch = 'ALL';
  let activeFilterYear = 'ALL';

  function renderStudentBadges() {
    const container = document.getElementById('cardsContainer');
    if (!container) return;

    let students = RosterManager.getAllStudents();

    if (activeFilterBranch !== 'ALL') {
      students = students.filter(s => s.branch === activeFilterBranch);
    }
    if (activeFilterYear !== 'ALL') {
      students = students.filter(s => s.year === activeFilterYear);
    }

    if (students.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
          <i class="fa-solid fa-id-card-clip" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.4;"></i>
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

      card.innerHTML = `
        <div class="id-card-college">
          <i class="fa-solid fa-graduation-cap"></i> University Student ID
        </div>
        <div class="id-card-qr-box" id="${qrBoxId}"></div>
        <div class="id-card-name">${escapeHtml(student.name)}</div>
        <div class="id-card-roll">${escapeHtml(student.rollNo)}</div>
        <div class="id-card-badges">
          <span class="tag tag-branch">${escapeHtml(student.branch.split('(')[1]?.replace(')', '') || student.branch)}</span>
          <span class="tag tag-year">${escapeHtml(student.year)}</span>
        </div>
        <div class="id-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="QRStudio.downloadQR('${student.rollNo}', '${escapeHtml(student.name)}')">
            <i class="fa-solid fa-download"></i> Save QR
          </button>
          <button class="btn btn-primary btn-sm" onclick="App.simulateScan('${student.rollNo}')">
            <i class="fa-solid fa-barcode"></i> Test Scan
          </button>
        </div>
      `;

      container.appendChild(card);

      // Render QR inside qrBox
      setTimeout(() => {
        generateQRCode(qrBoxId, student.rollNo);
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
    img.style.width = '140px';
    img.style.height = '140px';
    el.appendChild(img);
  }

  function downloadQR(rollNo, studentName) {
    const cleanRoll = rollNo.replace(/[^a-zA-Z0-9]/g, '');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(rollNo)}&margin=15`;
    
    // Fetch image as blob to trigger direct download
    fetch(qrUrl)
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `QR_${cleanRoll}_${studentName.replace(/\s+/g, '_')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showToast(`Downloaded QR for ${rollNo}`, 'success');
      })
      .catch(() => {
        // Fallback: open image in new tab
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
    renderStudentBadges,
    generateQRCode,
    downloadQR,
    setFilters,
    printAllBadges
  };
})();
