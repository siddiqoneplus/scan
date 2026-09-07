/**
 * ROSTER & GOOGLE FORM INTEGRATION ENGINE
 * Handles student registration, automatic roll number classification,
 * Google Form CSV import, and whitelist validation.
 */

const RosterManager = (() => {
  const STORAGE_KEY = 'smart_attendance_roster';
  const RULES_KEY = 'smart_attendance_rules';

  // University branch mapping codes: 44=Data Science, 61=AIML, 43=CAI, etc.
  const DEFAULT_BRANCH_CODES = {
    // 2-digit JNTU/University branch codes
    '01': 'Civil Engineering (CIVIL)',
    '02': 'Electrical & Electronics (EEE)',
    '03': 'Mechanical Engineering (MECH)',
    '04': 'Electronics & Communication (ECE)',
    '05': 'Computer Science & Engineering (CSE)',
    '12': 'Information Technology (IT)',
    '42': 'Artificial Intelligence & Data Science (AI&DS)',
    '43': 'CAI (Computer Science & AI)',
    '44': 'Data Science (DS)',
    '61': 'AIML (AI & Machine Learning)',
    '62': 'Cyber Security (CS)',
    '63': 'Internet of Things (IoT)',
    // Text abbreviations
    'CSE': 'Computer Science & Engineering (CSE)',
    'ECE': 'Electronics & Communication (ECE)',
    'MECH': 'Mechanical Engineering (MECH)',
    'CIVIL': 'Civil Engineering (CIVIL)',
    'EEE': 'Electrical & Electronics (EEE)',
    'IT': 'Information Technology (IT)',
    'DS': 'Data Science (DS)',
    'CSD': 'Data Science (DS)',
    'AIDS': 'Artificial Intelligence & Data Science (AI&DS)',
    'AIML': 'AIML (AI & Machine Learning)',
    'CSM': 'AIML (AI & Machine Learning)',
    'CAI': 'CAI (Computer Science & AI)'
  };

  // Seed data featuring university format (26=1st Year, 25=2nd Year, 24=3rd Year, 23=4th Year)
  const DEFAULT_STUDENTS = [
    { rollNo: '24A81A4401', name: 'Aarav Sharma', branch: 'Data Science (DS)', year: '2024 Batch (3rd Year)' },
    { rollNo: '24A81A6101', name: 'Charan Teja', branch: 'AIML (AI & Machine Learning)', year: '2024 Batch (3rd Year)' },
    { rollNo: '24A81A4301', name: 'Eshwar Kumar', branch: 'CAI (Computer Science & AI)', year: '2024 Batch (3rd Year)' },
    { rollNo: '25A81A4402', name: 'Bhavya Sri', branch: 'Data Science (DS)', year: '2025 Batch (2nd Year)' },
    { rollNo: '25A81A6102', name: 'Divya Reddy', branch: 'AIML (AI & Machine Learning)', year: '2025 Batch (2nd Year)' },
    { rollNo: '26A81A4403', name: 'Gautam Verma', branch: 'Data Science (DS)', year: '2026 Batch (1st Year)' },
    { rollNo: '26A81A6103', name: 'Fathima Begum', branch: 'AIML (AI & Machine Learning)', year: '2026 Batch (1st Year)' },
    { rollNo: '26A81A4303', name: 'Karthik Raja', branch: 'CAI (Computer Science & AI)', year: '2026 Batch (1st Year)' },
    { rollNo: '23A81A4415', name: 'Harika Nair', branch: 'Data Science (DS)', year: '2023 Batch (4th Year)' },
    { rollNo: '23A81A6120', name: 'Irfan Pasha', branch: 'AIML (AI & Machine Learning)', year: '2023 Batch (4th Year)' },
    { rollNo: '23A81A4310', name: 'Jyothi Priya', branch: 'CAI (Computer Science & AI)', year: '2023 Batch (4th Year)' }
  ];

  let students = [];
  let branchCodes = { ...DEFAULT_BRANCH_CODES };

  function init() {
    loadStudents();
  }

  function loadStudents() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        students = JSON.parse(saved);
        // Automatically re-sync year for students to match latest batch mapping rules (23->4th, 24->3rd, 25->2nd, 26->1st)
        let updated = false;
        students.forEach(s => {
          if (s.rollNo) {
            const classified = autoClassifyRollNumber(s.rollNo);
            if (s.year !== classified.year) {
              s.year = classified.year;
              updated = true;
            }
          }
        });

        // Ensure 24A81A4401 is present
        const hasSample = students.some(s => s.rollNo === '24A81A4401');
        if (!hasSample) {
          const existingRolls = new Set(students.map(s => s.rollNo.toUpperCase()));
          DEFAULT_STUDENTS.forEach(ds => {
            if (!existingRolls.has(ds.rollNo.toUpperCase())) {
              students.push(ds);
            }
          });
          updated = true;
        }

        if (updated) {
          saveStudents();
        }
      } catch (e) {
        console.error('Failed to parse roster from storage', e);
        students = [...DEFAULT_STUDENTS];
        saveStudents();
      }
    } else {
      students = [...DEFAULT_STUDENTS];
      saveStudents();
    }

    const savedRules = localStorage.getItem(RULES_KEY);
    if (savedRules) {
      try {
        branchCodes = { ...DEFAULT_BRANCH_CODES, ...JSON.parse(savedRules) };
      } catch (e) {
        console.error('Failed to parse rules from storage', e);
      }
    } else {
      branchCodes = { ...DEFAULT_BRANCH_CODES };
    }
  }

  function saveStudents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
    window.dispatchEvent(new CustomEvent('roster:updated', { detail: { count: students.length } }));
  }

  /**
   * Intelligently classifies Branch and Academic Year/Batch from Roll Number patterns
   * Examples supported:
   * 1. University format: 24A81A4401 -> 24 = 2024 Batch, 44 = Data Science (DS)
   * 2. University format: 24A81A6101 -> 24 = 2024 Batch, 61 = AIML
   * 3. University format: 24A81A4301 -> 24 = 2024 Batch, 43 = CAI
   * 4. Hyphen format: 24-DS-045 -> 2024 Batch, Data Science
   */
  function autoClassifyRollNumber(rawRollNo) {
    if (!rawRollNo) return { branch: 'General', year: '2024 Batch (1st Year)' };
    const roll = rawRollNo.trim().toUpperCase();

    let detectedYear = '2024 Batch (1st Year)';
    let detectedBranch = 'Data Science (DS)';

    // Pattern 1: Hyphen format like 24-DS-045 or 24-AIML-001 or 24-CAI-012
    const hyphenMatch = roll.match(/^(\d{2})-([A-Z0-9]+)-\d+$/);
    if (hyphenMatch) {
      const yearPrefix = parseInt(hyphenMatch[1], 10);
      const branchCode = hyphenMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `${branchCode} Department`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 2: University format like 24A81A4401 (24=Batch, A8=College, 1A=Degree, 44=Branch, 01=Seq)
    // Supports regular (1A) and lateral entry (5A)
    const univMatch = roll.match(/^(\d{2})[A-Z0-9]{4}(\d{2})[A-Z0-9]+$/);
    if (univMatch) {
      const yearPrefix = parseInt(univMatch[1], 10);
      const branchCode = univMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `Branch (${branchCode})`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 3: Short prefix like 24DS012 or 24AIML055 or 24CAI001
    const shortMatch = roll.match(/^(\d{2})([A-Z]{2,5})\d+$/);
    if (shortMatch) {
      const yearPrefix = parseInt(shortMatch[1], 10);
      const branchCode = shortMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `${branchCode} Department`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 4: Check if starts with 2-digit year (e.g. 24...)
    const yearLead = roll.match(/^(\d{2})/);
    if (yearLead) {
      detectedYear = calculateAcademicYear(parseInt(yearLead[1], 10));
    }

    // Check for branch keywords inside roll (avoid numeric false matches)
    for (const [key, name] of Object.entries(branchCodes)) {
      if (isNaN(key) && roll.includes(key)) {
        detectedBranch = name;
        break;
      }
    }

    return { branch: detectedBranch, year: detectedYear };
  }

  function calculateAcademicYear(joinYear2Digit) {
    const fullYear = 2000 + joinYear2Digit;
    // Map cohorts for the academic cycle:
    // 26 -> 2026 Batch (1st Year)
    // 25 -> 2025 Batch (2nd Year)
    // 24 -> 2024 Batch (3rd Year)
    // 23 -> 2023 Batch (4th Year)
    const batchMap = {
      26: '1st Year',
      25: '2nd Year',
      24: '3rd Year',
      23: '4th Year'
    };

    const yearLevel = batchMap[joinYear2Digit] || (joinYear2Digit >= 26 ? '1st Year' : (joinYear2Digit <= 23 ? '4th Year' : '1st Year'));
    return `${fullYear} Batch (${yearLevel})`;
  }

  /**
   * Check if a roll number is in the admin whitelist
   */
  function isRollNumberAssigned(rawRollNo) {
    if (!rawRollNo) return false;
    const cleanRoll = rawRollNo.trim().toUpperCase();
    return students.some(s => s.rollNo.trim().toUpperCase() === cleanRoll);
  }

  /**
   * Find student by roll number
   */
  function findStudent(rawRollNo) {
    if (!rawRollNo) return null;
    const cleanRoll = rawRollNo.trim().toUpperCase();
    return students.find(s => s.rollNo.trim().toUpperCase() === cleanRoll) || null;
  }

  /**
   * Add a new student
   */
  function addStudent({ rollNo, name, branch, year }) {
    if (!rollNo || !name) throw new Error('Roll Number and Name are required.');
    const cleanRoll = rollNo.trim().toUpperCase();
    
    if (isRollNumberAssigned(cleanRoll)) {
      throw new Error(`Roll Number ${cleanRoll} is already registered.`);
    }

    const classification = autoClassifyRollNumber(cleanRoll);
    const newStudent = {
      rollNo: cleanRoll,
      name: name.trim(),
      branch: branch && branch.trim() !== '' ? branch.trim() : classification.branch,
      year: year && year.trim() !== '' ? year.trim() : classification.year,
      addedAt: new Date().toISOString()
    };

    students.unshift(newStudent);
    saveStudents();
    return newStudent;
  }

  /**
   * Update student details
   */
  function updateStudent(rollNo, updatedData) {
    const cleanRoll = rollNo.trim().toUpperCase();
    const index = students.findIndex(s => s.rollNo.trim().toUpperCase() === cleanRoll);
    if (index === -1) throw new Error(`Student ${rollNo} not found.`);

    students[index] = { ...students[index], ...updatedData };
    saveStudents();
    return students[index];
  }

  /**
   * Delete student
   */
  function deleteStudent(rollNo) {
    const cleanRoll = rollNo.trim().toUpperCase();
    const initialLen = students.length;
    students = students.filter(s => s.rollNo.trim().toUpperCase() !== cleanRoll);
    if (students.length !== initialLen) {
      saveStudents();
      return true;
    }
    return false;
  }

  /**
   * Google Form / Sheet CSV Importer
   * Parses CSV string and maps columns automatically.
   */
  function importGoogleFormCSV(csvString) {
    if (!csvString || !csvString.trim()) {
      throw new Error('CSV text is empty.');
    }

    const lines = csvString.trim().split(/\r\n|\n|\r/);
    if (lines.length < 2) {
      throw new Error('CSV must contain at least a header row and one student data row.');
    }

    // Helper to split CSV line handling quotes
    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      return result;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    
    // Column index detectors
    let rollIndex = headers.findIndex(h => h.includes('roll') || h.includes('hall ticket') || h.includes('reg') || h.includes('id') || h.includes('pin'));
    let nameIndex = headers.findIndex(h => h.includes('name') || h.includes('student'));
    let branchIndex = headers.findIndex(h => h.includes('branch') || h.includes('dept') || h.includes('department'));
    let yearIndex = headers.findIndex(h => h.includes('year') || h.includes('sem') || h.includes('class'));

    // Fallbacks if headers didn't match
    if (rollIndex === -1) {
      // Look for second column or first column
      rollIndex = 1 < headers.length ? 1 : 0;
    }
    if (nameIndex === -1) {
      nameIndex = 0 !== rollIndex ? 0 : 1;
    }

    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCSVLine(line);
      const rawRoll = cols[rollIndex] ? cols[rollIndex].trim().toUpperCase() : '';
      const rawName = cols[nameIndex] ? cols[nameIndex].trim() : '';

      if (!rawRoll) {
        skippedCount++;
        continue;
      }

      const auto = autoClassifyRollNumber(rawRoll);
      const branch = (branchIndex !== -1 && cols[branchIndex]) ? cols[branchIndex].trim() : auto.branch;
      const year = (yearIndex !== -1 && cols[yearIndex]) ? cols[yearIndex].trim() : auto.year;
      const name = rawName || `Student ${rawRoll}`;

      const existingIdx = students.findIndex(s => s.rollNo.toUpperCase() === rawRoll);
      if (existingIdx !== -1) {
        // Update existing student
        students[existingIdx] = {
          ...students[existingIdx],
          name,
          branch,
          year,
          updatedAt: new Date().toISOString()
        };
        importedCount++;
      } else {
        // Add new student
        students.push({
          rollNo: rawRoll,
          name,
          branch,
          year,
          addedAt: new Date().toISOString()
        });
        importedCount++;
      }
    }

    saveStudents();
    return { importedCount, skippedCount, total: students.length };
  }

  function resetToDefault() {
    students = [...DEFAULT_STUDENTS];
    saveStudents();
    return students;
  }

  function clearAll() {
    students = [];
    saveStudents();
    return [];
  }

  return {
    init,
    getAllStudents: () => [...students],
    findStudent,
    isRollNumberAssigned,
    addStudent,
    updateStudent,
    deleteStudent,
    autoClassifyRollNumber,
    importGoogleFormCSV,
    resetToDefault,
    clearAll
  };
})();
