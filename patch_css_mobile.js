const fs = require('fs');

let style = fs.readFileSync('css/style.css', 'utf8');

// The mobile layout CSS updates
const mobileCSSPatch = `
  /* Tab 1: Scanner Station Mobile Optimized */
  .scanner-grid {
    display: flex !important;
    flex-direction: column;
    gap: 0.85rem;
  }
  
  .scanner-side-panel {
    display: contents;
  }
  
  #sessionControlCard {
    order: 1;
    margin-bottom: 0 !important; /* Managed by grid gap */
  }
  
  /* Make the camera take up more screen on mobile */
  .scanner-station-card {
    order: 2;
    padding: 0.85rem;
    border-radius: var(--radius-lg);
  }
  
  .scanner-viewport-wrapper {
    min-height: 40vh; /* Dynamic large camera */
    max-height: 55vh;
  }
  
  .scan-frame {
    width: 260px;
    height: 260px;
  }
  
  .station-controls .btn {
    min-height: 50px;
    font-size: 1.1rem;
    font-weight: bold;
    border-radius: 12px;
  }
  
  #sessionControlCard .btn {
    min-height: 54px;
    font-size: 1.1rem;
    font-weight: bold;
    border-radius: 12px;
    touch-action: manipulation;
  }
  
  /* Fix Scan Result at bottom */
  #scanResultBanner {
    order: 3; /* Fallback */
    position: fixed !important;
    bottom: 20px;
    left: 15px;
    right: 15px;
    z-index: 9999;
    box-shadow: 0 -5px 30px rgba(0,0,0,0.6);
    border-radius: 16px;
    margin: 0 !important;
    animation: slideUpToast 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  }
  
  @keyframes slideUpToast {
    from { transform: translateY(150%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .scanner-feed-card {
    order: 4;
  }
`;

// Replace the old mobile block for `.scanner-grid` inside max-width: 768px
const regex = /\/\* Tab 1: Scanner Station \*\/[\s\S]*?\.scanner-viewport-wrapper \{[\s\S]*?\}[\s\S]*?\.scan-frame \{[\s\S]*?\}/;

if (style.match(regex)) {
   style = style.replace(regex, mobileCSSPatch);
} else {
   // Fallback: append at the end of the mobile media query
   // Find the end of the file where the media query closes, or just append it wrapped in a media query
   style += '\n@media (max-width: 768px) {\n' + mobileCSSPatch + '\n}\n';
}

fs.writeFileSync('css/style.css', style);
console.log("Patched style.css");
