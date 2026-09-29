const fs = require('fs');
let content = fs.readFileSync('js/app.js', 'utf8');

const rulesJs = `
  // --- CLASSIFICATION RULES ---
  let classificationRules = [];

  async function loadClassificationRules() {
    try {
      const res = await fetch('/api/rules', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '') }
      });
      const data = await res.json();
      if (data.success) {
        classificationRules = data.rules || [];
        renderClassificationRules();
      }
    } catch (e) {
      console.warn('Failed to load rules:', e);
    }
  }

  function renderClassificationRules() {
    const tbody = document.getElementById('classificationRulesTableBody');
    if (!tbody) return;
    
    if (classificationRules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No rules configured.</td></tr>';
      return;
    }

    tbody.innerHTML = classificationRules.map(r => \`
      <tr class="\${r.enabled ? '' : 'text-muted'}">
        <td><strong>\${r.prefix}</strong></td>
        <td>\${r.startRange} - \${r.endRange}</td>
        <td>\${r.academicYear}</td>
        <td>\${r.branch}</td>
        <td>\${r.section || '-'}</td>
        <td>
          <span class="badge \${r.enabled ? 'badge-success' : 'badge-secondary'}">\${r.enabled ? 'Active' : 'Disabled'}</span>
        </td>
        <td class="text-right">
          <button class="btn btn-secondary btn-icon btn-sm" onclick="App.editClassificationRule('\${r.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-danger btn-icon btn-sm" onclick="App.deleteClassificationRule('\${r.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    \`).join('');
  }

  window.addEventListener('modalOpened', (e) => {
    if (e.detail === 'modalClassificationRules') {
      loadClassificationRules();
    }
  });

  async function submitClassificationRule(e) {
    e.preventDefault();
    
    const rule = {
      id: document.getElementById('ruleId').value || '',
      prefix: document.getElementById('rulePrefix').value.trim(),
      startRange: parseInt(document.getElementById('ruleStart').value, 10),
      endRange: parseInt(document.getElementById('ruleEnd').value, 10),
      academicYear: document.getElementById('ruleYear').value.trim(),
      branch: document.getElementById('ruleBranch').value.trim(),
      section: document.getElementById('ruleSection').value.trim(),
      enabled: document.getElementById('ruleEnabled').checked
    };
    
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
        },
        body: JSON.stringify(rule)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Rule saved successfully', 'success');
        document.getElementById('formAddClassificationRule').reset();
        document.getElementById('ruleId').value = '';
        loadClassificationRules();
      } else {
        showToast(data.error || 'Failed to save rule', 'error');
      }
    } catch (err) {
      showToast('Network error: ' + err.message, 'error');
    }
  }

  function editClassificationRule(id) {
    const r = classificationRules.find(x => x.id === id);
    if (!r) return;
    document.getElementById('ruleId').value = r.id;
    document.getElementById('rulePrefix').value = r.prefix;
    document.getElementById('ruleStart').value = r.startRange;
    document.getElementById('ruleEnd').value = r.endRange;
    document.getElementById('ruleYear').value = r.academicYear;
    document.getElementById('ruleBranch').value = r.branch;
    document.getElementById('ruleSection').value = r.section || '';
    document.getElementById('ruleEnabled').checked = r.enabled !== false;
  }

  async function deleteClassificationRule(id) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      const res = await fetch('/api/rules', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('auth_token') || '')
        },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Rule deleted', 'success');
        loadClassificationRules();
      } else {
        showToast(data.error || 'Failed to delete rule', 'error');
      }
    } catch (err) {
      showToast('Network error: ' + err.message, 'error');
    }
  }
`;

content = content.replace('// --- APP INITIALIZATION ---', rulesJs + '\n  // --- APP INITIALIZATION ---');

// Export functions
const exportLine = '    submitClassificationRule,\n    editClassificationRule,\n    deleteClassificationRule,';
content = content.replace('    submitAddBranchRule,', exportLine + '\n    submitAddBranchRule,');

fs.writeFileSync('js/app.js', content);
