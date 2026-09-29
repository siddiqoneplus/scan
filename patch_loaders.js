const fs = require('fs');

let appjs = fs.readFileSync('js/app.js', 'utf8');

// Inject the loader helper
const loaderHelper = `
  // --- UI Loader State Manager ---
  function setBtnLoading(btnElement, isLoading, loadingText = 'Loading...') {
     if (!btnElement) return;
     if (isLoading) {
        if(btnElement.disabled && !btnElement.dataset.originalText) return; // already loading
        btnElement.disabled = true;
        btnElement.dataset.originalText = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + loadingText;
     } else {
        btnElement.disabled = false;
        if (btnElement.dataset.originalText) {
            btnElement.innerHTML = btnElement.dataset.originalText;
            delete btnElement.dataset.originalText;
        }
     }
  }
`;

if (!appjs.includes('function setBtnLoading')) {
   appjs = appjs.replace('function showToast', loaderHelper + '\n  function showToast');
}

// 1. Patch Login Form
const loginFormListener = `document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    App.setBtnLoading(btn, true, 'Signing in...');
    
    const un = document.getElementById('usernameInput').value;
    const pw = document.getElementById('passwordInput').value;
    const remember = document.getElementById('rememberMeInput')?.checked || false;
    
    if (!un || !pw) {
      App.showToast('Please enter both username and password.', 'error');
      App.setBtnLoading(btn, false);
      return;
    }
    
    const data = await AuthManager.login(un, pw, remember);
    App.setBtnLoading(btn, false);
    
    if (data.success) {
      App.showToast('Login Successful!', 'success');
      document.getElementById('loginOverlay').style.display = 'none';
      App.refreshAllViews();
    } else {
      App.showToast(data.error || 'Invalid credentials.', 'error');
    }
  });`;

// Remove existing loginForm listener
appjs = appjs.replace(/document\.getElementById\('loginForm'\)\?\.addEventListener\('submit',[\s\S]*?\}\);/, loginFormListener);


// 2. Patch submitAddStudent to be async
const newSubmitAddStudent = `  async function submitAddStudent(e) {
    if (e) e.preventDefault();
    const btn = e ? e.submitter : null;
    App.setBtnLoading(btn, true, 'Saving...');
    
    const rollNo = document.getElementById('newStudentRoll')?.value;
    const name = document.getElementById('newStudentName')?.value;
    const branch = document.getElementById('newStudentBranch')?.value;
    const year = document.getElementById('newStudentYear')?.value;
    const section = document.getElementById('newStudentSection')?.value || '';
    const assignedTo = document.getElementById('newStudentAssignedTo')?.value || 'all';

    try {
      // Instead of relying purely on RosterManager local push, do the API call
      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') },
        body: JSON.stringify([{ rollNo, name, branch, year, section, assignedTo }])
      });
      const data = await res.json();
      App.setBtnLoading(btn, false);
      
      if (data.success) {
        closeModal('modalAddStudent');
        const assignLabel = assignedTo === 'all' ? 'All Employees' : assignedTo;
        showToast(\`Student \${rollNo} registered & assigned to \${assignLabel}!\`, 'success');
        document.getElementById('formAddStudent').reset();
        fetchAndRenderRoster(1);
      } else {
        showToast(data.error || 'Failed to add student', 'error');
      }
    } catch (err) {
      App.setBtnLoading(btn, false);
      showToast(err.message || 'Network Error', 'error');
    }
  }`;

appjs = appjs.replace(/function submitAddStudent\(e\) \{[\s\S]*?catch \(err\) \{[\s\S]*?showToast\(err\.message, 'error'\);\s*\}\s*\}/, newSubmitAddStudent);


// 3. Patch submitEditStudent to be async
const newSubmitEditStudent = `  async function submitEditStudent(e) {
    if (e) e.preventDefault();
    const btn = e ? e.submitter : null;
    App.setBtnLoading(btn, true, 'Saving...');
    
    const rollNo = document.getElementById('editStudentRoll')?.value;
    const name = document.getElementById('editStudentName')?.value;
    const branch = document.getElementById('editStudentBranch')?.value;
    const year = document.getElementById('editStudentYear')?.value;
    const section = document.getElementById('editStudentSection')?.value || '';
    const assignedTo = document.getElementById('editStudentAssignedTo')?.value || 'all';

    try {
      const res = await fetch('/api/roster/student', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') },
        body: JSON.stringify({ rollNo, action: 'edit', updates: { name, branch, year, section, assignedTo } })
      });
      const data = await res.json();
      App.setBtnLoading(btn, false);
      
      if (data.success) {
        closeModal('modalEditStudent');
        showToast(\`Student \${rollNo} updated!\`, 'success');
        fetchAndRenderRoster(rosterCurrentPage);
      } else {
        showToast(data.error || 'Failed to update student', 'error');
      }
    } catch (err) {
      App.setBtnLoading(btn, false);
      showToast(err.message || 'Network Error', 'error');
    }
  }`;

appjs = appjs.replace(/function submitEditStudent\(e\) \{[\s\S]*?catch \(err\) \{[\s\S]*?showToast\(err\.message, 'error'\);\s*\}\s*\}/, newSubmitEditStudent);


// 4. Patch submitImportGoogleForm
appjs = appjs.replace(/async function submitImportGoogleForm\(\) \{[\s\n]*const rawText = document.getElementById\('csvPasteArea'\)\?.value;/,
  "async function submitImportGoogleForm() {\n    const btn = document.querySelector('#modalImportStudents .btn-primary');\n    App.setBtnLoading(btn, true, 'Importing...');\n    const rawText = document.getElementById('csvPasteArea')?.value;");

appjs = appjs.replace(/showToast\(data\.error \|\| 'Import failed', 'error'\);[\s\n]*\}[\s\n]*\} else \{[\s\n]*fetchAndRenderRoster\(1\);[\s\n]*\}/,
  "showToast(data.error || 'Import failed', 'error');\n        App.setBtnLoading(btn, false);\n      }\n    } else {\n      fetchAndRenderRoster(1);\n      App.setBtnLoading(btn, false);\n    }");

appjs = appjs.replace(/showToast\('Network error during import', 'error'\);[\s\n]*\}/,
  "App.setBtnLoading(btn, false);\n      showToast('Network error during import', 'error');\n    }");


// 5. Expose setBtnLoading 
if (!appjs.includes('setBtnLoading,')) {
    appjs = appjs.replace('showToast,', 'showToast,\n    setBtnLoading,');
}

fs.writeFileSync('js/app.js', appjs);
console.log('Patched API functions with loading states');
