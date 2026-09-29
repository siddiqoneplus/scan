const fs = require('fs');

// Patch roster.js
let roster = fs.readFileSync('js/roster.js', 'utf8');

// Remove autoClassifyRollNumber completely
roster = roster.replace(/function autoClassifyRollNumber[\s\S]*?function calculateAcademicYear/g, 'function calculateAcademicYear');
roster = roster.replace(/function calculateAcademicYear[\s\S]*?\/\*\*/g, '/**');
roster = roster.replace(/autoClassifyRollNumber,/g, '');

// Fix usage in roster.js
roster = roster.replace(
  'const classified = autoClassifyRollNumber(s.rollNo);',
  'const classified = { branch: s.branch || "General", year: s.year || "2024 Batch (1st Year)" };'
);

roster = roster.replace(
  'const classification = autoClassifyRollNumber(cleanRoll);\n    const newStudent = {\n      rollNo: cleanRoll,\n      name: name.trim(),\n      branch: branch && branch.trim() !== \'\' ? branch.trim() : classification.branch,\n      year: year && year.trim() !== \'\' ? year.trim() : classification.year,\n      section: section ? section.trim().toUpperCase() : \'\',\n      assignedTo: assignedTo && assignedTo.trim() !== \'\' ? assignedTo.trim() : \'all\',\n      addedAt: new Date().toISOString()\n    };',
  'const newStudent = {\n      rollNo: cleanRoll,\n      name: name.trim(),\n      branch: branch && branch.trim() !== \'\' ? branch.trim() : "General",\n      year: year && year.trim() !== \'\' ? year.trim() : "2024 Batch (1st Year)",\n      section: section ? section.trim().toUpperCase() : \'\',\n      assignedTo: assignedTo && assignedTo.trim() !== \'\' ? assignedTo.trim() : \'all\',\n      addedAt: new Date().toISOString()\n    };'
);
fs.writeFileSync('js/roster.js', roster);

// Patch scanner.js
let scanner = fs.readFileSync('js/scanner.js', 'utf8');
scanner = scanner.replace(
  'const classification = RosterManager.autoClassifyRollNumber(rollNo);\n    const studentName = parsed.name || (student ? student.name : `Student ${rollNo}`);\n    const studentBranch = parsed.branch || (student ? student.branch : classification.branch);\n    const studentYear = parsed.year || (student ? student.year : classification.year);\n    const studentSection = parsed.section || (student ? student.section : \'\');',
  'const studentName = parsed.name || (student ? student.name : `Student ${rollNo}`);\n    const studentBranch = parsed.branch || (student ? student.branch : "General");\n    const studentYear = parsed.year || (student ? student.year : "2024 Batch (1st Year)");\n    const studentSection = parsed.section || (student ? student.section : \'\');'
);
fs.writeFileSync('js/scanner.js', scanner);

// Patch app.js
let app = fs.readFileSync('js/app.js', 'utf8');
app = app.replace(
  '        const classified = RosterManager.autoClassifyRollNumber(val);\n        branchInput.value = classified.branch;\n        yearInput.value = classified.year;\n        if (hint) {\n          hint.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-detected: <strong>${classified.branch}</strong> • <strong>${classified.year}</strong>`;\n          hint.style.display = \'block\';\n        }',
  '        if (hint) hint.style.display = \'none\';'
);
fs.writeFileSync('js/app.js', app);

// Patch analytics.js
let analytics = fs.readFileSync('js/analytics.js', 'utf8');
analytics = analytics.replace(
  '            const classified = RosterManager.autoClassifyRollNumber(r.rollNo);\n            if (r.year !== classified.year) {\n              r.year = classified.year;\n              updated = true;\n            }',
  ''
);
fs.writeFileSync('js/analytics.js', analytics);

console.log("Patched all files.");
