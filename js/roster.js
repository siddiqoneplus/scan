/**
 * ROSTER & GOOGLE FORM INTEGRATION ENGINE
 * Handles student registration, automatic roll number classification,
 * Google Form CSV import, and whitelist validation.
 */

const RosterManager = (() => {
  const STORAGE_KEY = 'smart_attendance_roster';
  const RULES_KEY = 'smart_attendance_rules';

  // Default branch mapping codes for university style roll numbers
  const DEFAULT_BRANCH_CODES = {
    '01': 'Civil Engineering (CIVIL)',
    '02': 'Electrical & Electronics (EEE)',
    '03': 'Mechanical Engineering (MECH)',
    '04': 'Electronics & Communication (ECE)',
    '05': 'Computer Science & Engineering (CSE)',
    '12': 'Information Technology (IT)',
    '42': 'Artificial Intelligence & Data Science (AI&DS)',
    '44': 'Data Science (DS)',
    '43': 'Cyber Security (CS)',
    'CSE': 'Computer Science & Engineering (CSE)',
    'ECE': 'Electronics & Communication (ECE)',
    'MECH': 'Mechanical Engineering (MECH)',
    'CIVIL': 'Civil Engineering (CIVIL)',
    'AIDS': 'Artificial Intelligence & Data Science (AI&DS)',
    'IT': 'Information Technology (IT)'
  };

  // Seed data for initial demo
  const DEFAULT_STUDENTS = [
    { rollNo: '21B91A0501', name: 'Aarav Sharma', branch: 'Computer Science (CSE)', year: '4th Year' },
    { rollNo: '21B91A0502', name: 'Ananya Verma', branch: 'Computer Science (CSE)', year: '4th Year' },
    { rollNo: '22B91A0415', name: 'Rohan Patel', branch: 'Electronics (ECE)', year: '3rd Year' },
    { rollNo: '22B91A0420', name: 'Sneha Reddy', branch: 'Electronics (ECE)', year: '3rd Year' },
    { rollNo: '23B91A4208', name: 'Devendra Nair', branch: 'AI & Data Science (AI&DS)', year: '2nd Year' },
    { rollNo: '23B91A4212', name: 'Pooja Iyer', branch: 'AI & Data Science (AI&DS)', year: '2nd Year' },
    { rollNo: '24B91A0305', name: 'Vikram Joshi', branch: 'Mechanical (MECH)', year: '1st Year' },
    { rollNo: '24B91A0518', name: 'Meera Kulkarni', branch: 'Computer Science (CSE)', year: '1st Year' },
    { rollNo: '23-CSE-045', name: 'Karthik Raja', branch: 'Computer Science (CSE)', year: '2nd Year' },
    { rollNo: '24-AIDS-012', name: 'Zara Khan', branch: 'AI & Data Science (AI&DS)', year: '1st Year' }
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
    }
  }

  function saveStudents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
    window.dispatchEvent(new CustomEvent('roster:updated', { detail: { count: students.length } }));
  }

  /**
   * Intelligently classifies Branch and Academic Year from Roll Number patterns
   * Examples supported:
   * 1. JNTU/State Univ format: 21B91A0501 -> Year 2021 (4th Year), Branch 05 (CSE)
   * 2. Hyphen format: 23-CSE-045 -> Year 2023 (2nd Year), Branch CSE
   * 3. Prefix format: 24CSE015 -> Year 2024 (1st Year), Branch CSE
   */
  function autoClassifyRollNumber(rawRollNo) {
    if (!rawRollNo) return { branch: 'General', year: '1st Year' };
    const roll = rawRollNo.trim().toUpperCase();

    let detectedYear = '1st Year';
    let detectedBranch = 'Computer Science (CSE)';

    // Pattern 1: Hyphen format like 23-CSE-045 or 24-AIDS-001
    const hyphenMatch = roll.match(/^(\d{2})-([A-Z]+)-\d+$/);
    if (hyphenMatch) {
      const yearPrefix = parseInt(hyphenMatch[1], 10);
      const branchCode = hyphenMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `${branchCode} Department`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 2: University format like 21B91A0501 or 22A81A4212
    // [2 digits Year][4 chars College/Degree][2 digits Branch][rest]
    const univMatch = roll.match(/^(\d{2})[A-Z0-9]{4}(\d{2})[A-Z0-9]+$/);
    if (univMatch) {
      const yearPrefix = parseInt(univMatch[1], 10);
      const branchCode = univMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `Branch (${branchCode})`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 3: Short prefix like 24CSE012 or 22ECE055
    const shortMatch = roll.match(/^(\d{2})([A-Z]{2,5})\d+$/);
    if (shortMatch) {
      const yearPrefix = parseInt(shortMatch[1], 10);
      const branchCode = shortMatch[2];
      detectedYear = calculateAcademicYear(yearPrefix);
      detectedBranch = branchCodes[branchCode] || `${branchCode} Department`;
      return { branch: detectedBranch, year: detectedYear };
    }

    // Pattern 4: Check if starts with 2-digit year
    const yearLead = roll.match(/^(\d{2})/);
    if (yearLead) {
      detectedYear = calculateAcademicYear(parseInt(yearLead[1], 10));
    }

    // Check for branch keywords inside roll
    for (const [key, name] of Object.entries(branchCodes)) {
      if (roll.includes(key)) {
        detectedBranch = name;
        break;
      }
    }

    return { branch: detectedBranch, year: detectedYear };
  }

  function calculateAcademicYear(joinYear2Digit) {
    // Current academic year reference (e.g. 2025/2026)
    const currentYear = new Date().getFullYear();
    const currentYear2Digit = currentYear % 100;
    const diff = currentYear2Digit - joinYear2Digit;

    if (diff <= 0) return '1st Year';
    if (diff === 1) return '2nd Year';
    if (diff === 2) return '3rd Year';
    if (diff >= 3) return '4th Year';
    return '1st Year';
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
