const fs = require('fs');
const css = `
/* Extract Styles */
.cold-start-overlay { position:fixed;top:0;left:0;width:100%;height:100%;background:#0f172a;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff; }
.cold-start-icon { font-size: 3.5rem; margin-bottom: 20px; color: #10b981; }
.cold-start-title { margin: 0; font-family: 'Inter', sans-serif; }
.cold-start-text { color: #94a3b8; text-align:center; max-width: 400px; padding: 20px; font-family: 'Inter', sans-serif; }
.cold-start-progress { width: 200px; height: 4px; background: #1e293b; border-radius: 4px; overflow: hidden; }
.cold-start-bar { width: 50%; height: 100%; background: #10b981; animation: slide 1.5s infinite linear; }
@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
.modal-qr-box { max-width: 420px; }
.modal-qr-body { background-color: var(--bg-primary); display: flex; flex-direction: column; align-items: center; }
.modal-qr-wrap { background: white; padding: 0.5rem; border-radius: 12px; margin-bottom: 1.5rem; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
.modal-qr-actions { justify-content: center; }
`;
fs.appendFileSync('css/style.css', css);
console.log('Appended to style.css');
