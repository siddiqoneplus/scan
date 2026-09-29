const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const oldBlock = `
        const studentsList = Array.isArray(body) ? body : (body.students || []);
        const normalized = studentsList.map(s => ({
          ...s,
          assignedTo: s.assignedTo || body.assignedTo || 'all'
        }));
        await db.saveStudents(normalized);
`;

const newBlock = `
        const studentsList = Array.isArray(body) ? body : (body.students || []);
        const rules = await db.getClassificationRules();
        
        const normalized = studentsList.map(s => {
          let classification = db.applyClassificationRules(s.rollNo, rules);
          let branch = s.branch;
          let year = s.year;
          let section = s.section;
          
          if (classification) {
            branch = classification.branch || branch;
            year = classification.academicYear || year;
            section = classification.section || section;
          }
          
          return {
            ...s,
            branch,
            year,
            section,
            assignedTo: s.assignedTo || body.assignedTo || 'all'
          };
        });
        await db.saveStudents(normalized);
`;

content = content.replace(oldBlock, newBlock);

fs.writeFileSync('server.js', content);
