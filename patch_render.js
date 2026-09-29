const fs = require('fs');

// 1. PATCH SERVER.JS
let server = fs.readFileSync('server.js', 'utf8');

// Fix CORS headers to allow PATCH
server = server.replace("'GET, POST, DELETE, OPTIONS'", "'GET, POST, DELETE, PATCH, OPTIONS'");

// Add /api/health endpoint
const healthEndpoint = `
    // --- HEALTH CHECK (Render Cold Start & Ping) ---
    if (reqPath === '/api/health') {
      return sendJson(res, 200, { success: true, status: 'ok', timestamp: new Date().toISOString() });
    }
`;
if (!server.includes("reqPath === '/api/health'")) {
    server = server.replace("if (reqPath === '/api/login' && req.method === 'POST') {", healthEndpoint + "\n    if (reqPath === '/api/login' && req.method === 'POST') {");
}

// Ensure localhost URL parsing doesn't break when deployed
// We will replace new URL('http://localhost' + req.url) with new URL('http://fake-domain.com' + req.url) 
// since it's just used to extract search params locally without a real host.
server = server.replace(/new URL\('http:\/\/localhost' \+ req\.url\)/g, "new URL('http://127.0.0.1' + req.url)");

// Prevent MongoDB crashes from taking down the server silently on cold start
// MongoDB already logs connection successfully or handles it via db.js, 
// so this should be fine.

fs.writeFileSync('server.js', server);
console.log('Patched server.js for Render deployment.');


// 2. PATCH INDEX.HTML (Cold start overlay)
let html = fs.readFileSync('index.html', 'utf8');

const overlay = `
  <!-- COLD START OVERLAY -->
  <div id="coldStartOverlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:#0f172a;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;">
      <div style="font-size: 3.5rem; margin-bottom: 20px; color: #10b981;"><i class="fa-solid fa-server fa-fade"></i></div>
      <h2 style="margin: 0; font-family: 'Inter', sans-serif;">Waking up Server...</h2>
      <p style="color: #94a3b8; text-align:center; max-width: 400px; padding: 20px; font-family: 'Inter', sans-serif;">
        Render spins down the free tier database after inactivity. Please wait up to 50 seconds for the application to boot up securely.
      </p>
      <div style="width: 200px; height: 4px; background: #1e293b; border-radius: 4px; overflow: hidden;">
         <div style="width: 50%; height: 100%; background: #10b981; animation: slide 1.5s infinite linear;"></div>
      </div>
      <style>
         @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
      </style>
  </div>
`;

if (!html.includes('id="coldStartOverlay"')) {
    html = html.replace('<body>', '<body>\n' + overlay);
}

fs.writeFileSync('index.html', html);
console.log('Patched index.html for cold starts.');


// 3. PATCH APP.JS (Ping health endpoint)
let appjs = fs.readFileSync('js/app.js', 'utf8');

const wakeUpLogic = `
  // --- COLD START WAKEUP ---
  async function ensureServerAwake() {
     const overlay = document.getElementById('coldStartOverlay');
     if (!overlay) return;
     
     const maxRetries = 30; // Wait up to 60 seconds (2s per try)
     let attempt = 0;
     
     while (attempt < maxRetries) {
       try {
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), 2000);
         const res = await fetch('/api/health', { signal: controller.signal });
         clearTimeout(timeoutId);
         
         if (res.ok) {
           overlay.style.display = 'none';
           return;
         }
       } catch (e) {
         // Network error or timeout, server still booting
       }
       attempt++;
       await new Promise(r => setTimeout(r, 2000));
     }
     
     // Fallback if it completely fails, remove overlay so they can see standard errors
     overlay.style.display = 'none';
     showToast('Server seems offline. Check connection.', 'error');
  }

`;

if (!appjs.includes('function ensureServerAwake()')) {
    appjs = appjs.replace('function init() {', wakeUpLogic + '\n  function init() {\n    ensureServerAwake();');
}

fs.writeFileSync('js/app.js', appjs);
console.log('Patched app.js for cold start logic.');

