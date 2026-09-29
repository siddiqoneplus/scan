const fs = require('fs');
let content = fs.readFileSync('db.js', 'utf8');

// Replace the normalization block in importStudents
const oldBlock = `
    // 5. Trim and normalize fields
    const name = typeof student.name === 'string' ? student.name.trim() : \`Student \${cleanRoll}\`;
    const branch = typeof student.branch === 'string' ? student.branch.trim() : 'General';
    const year = typeof student.year === 'string' ? student.year.trim() : '2024 Batch (3rd Year)';
    const section = typeof student.section === 'string' ? student.section.trim() : '';
`;

const newBlock = `
    // 5. Trim and normalize fields
    const name = typeof student.name === 'string' ? student.name.trim() : \`Student \${cleanRoll}\`;
    let branch = typeof student.branch === 'string' ? student.branch.trim() : '';
    let year = typeof student.year === 'string' ? student.year.trim() : '';
    let section = typeof student.section === 'string' ? student.section.trim() : '';

    const classification = applyClassificationRules(cleanRoll, _rulesContext);
    if (classification) {
       branch = classification.branch || branch;
       year = classification.academicYear || year;
       section = classification.section || section;
    }

    if (!branch) branch = 'General';
    if (!year) year = '2024 Batch (3rd Year)';
`;

content = content.replace(oldBlock, newBlock);

// We need to inject `_rulesContext` into `importStudents`
content = content.replace('async function importStudents(incoming, assignedTo = \'all\') {', 'async function importStudents(incoming, assignedTo = \'all\') {\n  const _rulesContext = await getClassificationRules();');

fs.writeFileSync('db.js', content);
