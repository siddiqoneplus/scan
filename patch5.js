const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

const classificationButton = `
          <div class="flex-btn-group admin-only-el">
            <button class="btn btn-secondary btn-sm" onclick="App.openModal('modalClassificationRules')" title="Advanced section assignment rules">
              <i class="fa-solid fa-layer-group"></i> Manage Classification Rules
            </button>
          </div>
`;

// Insert the new button in the admin card header
content = content.replace('<div class="flex-btn-group admin-only-el">', classificationButton + '\n          <div class="flex-btn-group admin-only-el">');

const classificationModal = `
  <!-- MODAL: CLASSIFICATION RULES (Admin Only) -->
  <div class="modal-backdrop" id="modalClassificationRules">
    <div class="modal-box modal-lg" style="max-width: 900px;">
      <div class="modal-header">
        <h3><i class="fa-solid fa-layer-group modal-icon-cyan"></i> Classification Rules</h3>
        <button class="btn btn-secondary btn-icon" onclick="App.closeModal('modalClassificationRules')">&times;</button>
      </div>
      <div class="modal-body">
        <p class="text-muted modal-desc">Configure roll-number prefixes to automatically assign Year, Branch, and Section.</p>

        <!-- Add Rule Form -->
        <form id="formAddClassificationRule" onsubmit="App.submitClassificationRule(event)" class="account-form">
          <input type="hidden" id="ruleId">
          <div class="account-form-row">
            <div class="form-group form-group-flush">
              <label for="rulePrefix">Roll Prefix *</label>
              <input type="text" id="rulePrefix" class="input-styled" placeholder="e.g. 24A81A44" required>
            </div>
            <div class="form-group form-group-flush">
              <label for="ruleStart">Start Range</label>
              <input type="number" id="ruleStart" class="input-styled" placeholder="1" required>
            </div>
            <div class="form-group form-group-flush">
              <label for="ruleEnd">End Range</label>
              <input type="number" id="ruleEnd" class="input-styled" placeholder="60" required>
            </div>
          </div>
          <div class="account-form-row mt-3">
            <div class="form-group form-group-flush">
              <label for="ruleYear">Academic Year *</label>
              <input type="text" id="ruleYear" class="input-styled" placeholder="e.g. 2024 Batch (3rd Year)" required>
            </div>
            <div class="form-group form-group-flush">
              <label for="ruleBranch">Branch *</label>
              <input type="text" id="ruleBranch" class="input-styled" placeholder="e.g. Data Science (DS)" required>
            </div>
            <div class="form-group form-group-flush">
              <label for="ruleSection">Section</label>
              <input type="text" id="ruleSection" class="input-styled" placeholder="e.g. A">
            </div>
          </div>
          <div class="account-form-row mt-3 align-items-center">
            <div class="form-group form-group-flush" style="display:flex; align-items:center; gap: 8px;">
              <input type="checkbox" id="ruleEnabled" checked style="width: 20px; height: 20px;">
              <label for="ruleEnabled" style="margin: 0; font-weight: normal;">Enabled</label>
            </div>
            <div class="text-right flex-grow">
              <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('formAddClassificationRule').reset(); document.getElementById('ruleId').value='';">Clear</button>
              <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-floppy-disk"></i> Save Rule</button>
            </div>
          </div>
        </form>

        <!-- Rules Table -->
        <div class="table-container max-h-300 mt-4">
          <table class="custom-table" id="classificationRulesTable">
            <thead>
              <tr>
                <th>Prefix</th>
                <th>Range</th>
                <th>Year</th>
                <th>Branch</th>
                <th>Section</th>
                <th>Status</th>
                <th class="text-right">Action</th>
              </tr>
            </thead>
            <tbody id="classificationRulesTableBody">
              <!-- Populated by JS -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
`;

content = content.replace('<!-- MODAL: CONFIGURE BRANCH RULES (Admin Only) -->', classificationModal + '\n  <!-- MODAL: CONFIGURE BRANCH RULES (Admin Only) -->');

fs.writeFileSync('index.html', content);
