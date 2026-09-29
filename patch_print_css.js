const fs = require('fs');

let css = fs.readFileSync('css/style.css', 'utf8');

const printCss = `
/* ==========================================================================
   PRINT STYLES FOR ID CARDS
   ========================================================================== */
@media print {
  /* Hide UI elements that shouldn't be printed */
  .sidebar,
  .top-header,
  .tab-buttons,
  .btn,
  .studio-controls,
  .modal-header,
  .modal-backdrop,
  .toast-container,
  #btnDownloadSingleQR {
    display: none !important;
  }

  /* Reset body and layout */
  body, html, .app-layout, .main-content {
    background: white !important;
    padding: 0 !important;
    margin: 0 !important;
    height: auto !important;
    overflow: visible !important;
    width: 100% !important;
  }

  /* When printing the single view modal */
  body.modal-open #modalViewQR {
    display: block !important;
    position: static !important;
    background: white !important;
  }
  body.modal-open #modalViewQR .modal-box {
    box-shadow: none !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    background: white !important;
  }
  body.modal-open #modalViewQR .modal-body {
    padding: 0 !important;
    margin: 0 !important;
    background: white !important;
    display: block !important;
  }
  body.modal-open #singleCardWrap {
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
  }

  /* Hide tabs except the one currently active or if modal is open, hide all tabs */
  body.modal-open .tab-pane {
    display: none !important;
  }
  
  /* When printing the whole studio */
  #tab3 {
    display: block !important;
  }
  .cards-grid {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 15px !important;
    justify-content: flex-start !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  .id-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    box-shadow: none !important;
    border: 1px solid #ddd !important;
    background: white !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    margin-bottom: 20px !important;
  }
  
  /* Make badges solid in print */
  .tag {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

if (!css.includes('@media print')) {
    fs.appendFileSync('css/style.css', printCss);
    console.log("Appended print CSS to style.css");
} else {
    console.log("Print CSS already exists.");
}
