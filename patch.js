const fs = require('fs');
let content = fs.readFileSync('db.js', 'utf8');

const rulesCode = `
// --- CLASSIFICATION RULES ---
async function getClassificationRules() {
  const localRules = readJsonFile('classification_rules.json', []);
  if (isConnected && db) {
    try {
      const atlasRules = await db.collection('classification_rules').find({}, { projection: { _id: 0 } }).toArray();
      const map = new Map();
      localRules.forEach(r => map.set(r.id, r));
      atlasRules.forEach(r => map.set(r.id, r));
      const merged = Array.from(map.values());
      writeJsonFile('classification_rules.json', merged);
      return merged;
    } catch (err) {
      console.warn('[MongoDB Atlas] Read rules error:', err.message);
    }
  }
  return localRules;
}

function checkRuleOverlap(newRule, existingRules) {
  for (const rule of existingRules) {
    if (rule.id === newRule.id) continue;
    
    // Check if prefixes match (case insensitive)
    if (rule.prefix.toUpperCase() === newRule.prefix.toUpperCase()) {
       // Check range overlap
       const maxStart = Math.max(rule.startRange, newRule.startRange);
       const minEnd = Math.min(rule.endRange, newRule.endRange);
       if (maxStart <= minEnd) {
         throw new Error(\`Rule overlaps with existing rule '\${rule.name || rule.id}' for prefix \${rule.prefix} (range \${maxStart}-\${minEnd})\`);
       }
    }
  }
}

async function saveClassificationRule(rule) {
  let rules = await getClassificationRules();
  
  if (!rule.id) {
    rule.id = 'rule-' + Date.now();
  }
  
  // Normalize types
  rule.startRange = parseInt(rule.startRange, 10) || 0;
  rule.endRange = parseInt(rule.endRange, 10) || 999999;
  rule.prefix = (rule.prefix || '').trim().toUpperCase();
  rule.enabled = rule.enabled !== false;
  
  checkRuleOverlap(rule, rules);
  
  const existingIdx = rules.findIndex(r => r.id === rule.id);
  if (existingIdx !== -1) {
    rules[existingIdx] = { ...rules[existingIdx], ...rule };
  } else {
    rules.push(rule);
  }
  
  writeJsonFile('classification_rules.json', rules);
  
  if (isConnected && db) {
    try {
      await db.collection('classification_rules').updateOne(
        { id: rule.id },
        { $set: rule },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[MongoDB Atlas] Save rule error:', e.message);
    }
  }
  
  return rule;
}

async function deleteClassificationRule(id) {
  let rules = await getClassificationRules();
  rules = rules.filter(r => r.id !== id);
  writeJsonFile('classification_rules.json', rules);
  
  if (isConnected && db) {
    try {
       await db.collection('classification_rules').deleteOne({ id });
    } catch (e) { }
  }
  return { success: true };
}

function applyClassificationRules(rollNo, rules) {
  if (!rollNo) return null;
  const cleanRoll = rollNo.trim().toUpperCase();
  
  // Find a matching rule
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    if (cleanRoll.startsWith(rule.prefix)) {
       const suffix = cleanRoll.substring(rule.prefix.length);
       // Parse suffix as integer
       const num = parseInt(suffix, 10);
       
       if (!isNaN(num) && num >= rule.startRange && num <= rule.endRange) {
         return {
           branch: rule.branch,
           academicYear: rule.academicYear,
           section: rule.section
         };
       }
    }
  }
  return null;
}
`;

// Insert the code before module.exports
if (!content.includes('getClassificationRules')) {
  content = content.replace('module.exports = {', rulesCode + '\nmodule.exports = {\n  getClassificationRules,\n  saveClassificationRule,\n  deleteClassificationRule,\n  applyClassificationRules,');
  fs.writeFileSync('db.js', content);
}
