const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const rulesEndpoints = `
    // --- CLASSIFICATION RULES API ---
    if (reqPath === '/api/rules') {
      if (req.method === 'GET') {
        if (!requireAdmin()) return;
        const rules = await db.getClassificationRules();
        return sendJson(res, 200, { success: true, rules });
      }
      if (req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        try {
           const rule = await db.saveClassificationRule(body);
           return sendJson(res, 200, { success: true, rule });
        } catch (e) {
           return sendJson(res, 400, { success: false, error: e.message });
        }
      }
      if (req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const body = await parseBody(req);
        if (!body.id) return sendJson(res, 400, { success: false, error: 'Rule ID required' });
        await db.deleteClassificationRule(body.id);
        return sendJson(res, 200, { success: true });
      }
    }
`;

// Insert the endpoints before "2. ROSTER IMPORT API"
content = content.replace('    // 2. ROSTER IMPORT API', rulesEndpoints + '\n    // 2. ROSTER IMPORT API');

fs.writeFileSync('server.js', content);
