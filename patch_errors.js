const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

const errorHandler = `
// --- Central API Error Handler ---
function handleApiError(res, err, defaultStatus = 500) {
  const timestamp = new Date().toISOString();
  
  // Log securely to server console (NO SECRETS EXPOSED TO CLIENT)
  console.error(\`[\${timestamp}] [ERROR]\`, err.name || 'Error', err.message);
  
  // Do not expose stack traces or MongoDB internals to the frontend
  let userMessage = 'An unexpected server error occurred.';
  let statusCode = defaultStatus;
  
  const rawMsg = err.message || '';
  
  if (err.name === 'ValidationError') {
     userMessage = 'Validation failed. Please check your data format.';
     statusCode = 400;
  } else if (rawMsg.includes('E11000') || rawMsg.includes('duplicate key')) {
     userMessage = 'A record with this identifier already exists (Duplicate Entry).';
     statusCode = 409;
  } else if (rawMsg.includes('DUPLICATE_ATTENDANCE')) {
     userMessage = 'Attendance already marked for this session.';
     statusCode = 409;
  } else if (rawMsg.includes('unauthorized') || rawMsg.includes('Access denied')) {
     userMessage = 'You do not have permission to perform this action.';
     statusCode = 403;
  } else if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
     userMessage = 'Database connection temporarily unavailable.';
     statusCode = 503;
  } else if (!rawMsg.includes('Mongo') && !rawMsg.includes('CastError') && !rawMsg.includes('ECONNREFUSED')) {
     // Expose safe, custom thrown errors
     userMessage = rawMsg;
  }
  
  return sendJson(res, statusCode, { success: false, error: userMessage });
}
`;

if (!server.includes('function handleApiError')) {
    server = server.replace('function sendJson(res, status, data) {', errorHandler + '\nfunction sendJson(res, status, data) {');
}

// Replace error sending globally
server = server.replace(/return sendJson\(res, \d+, \{ success: false, error: e\.message \}\);/g, "return handleApiError(res, e);");
server = server.replace(/return sendJson\(res, \d+, \{ success: false, error: err\.message \}\);/g, "return handleApiError(res, err);");

fs.writeFileSync('server.js', server);
console.log('Patched server.js with Centralized Error Handler');
