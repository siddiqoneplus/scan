const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

let styleCounter = 1;
const extractedStyles = [];

// Regex to find tags with style attribute
// This looks for `<tagName ... style="..." ... >`
html = html.replace(/(<[a-zA-Z0-9\-]+)([^>]*?)style="([^"]+)"([^>]*?>)/g, (match, p1, p2, styleContent, p4) => {
    // Generate a unique class name
    const className = `extract-style-${styleCounter++}`;
    extractedStyles.push(`.${className} { ${styleContent} }`);
    
    // Check if class attribute already exists in p2 or p4
    const classRegex = /class="([^"]*)"/;
    if (classRegex.test(p2)) {
        p2 = p2.replace(classRegex, `class="$1 ${className}"`);
        return p1 + p2 + p4;
    } else if (classRegex.test(p4)) {
        p4 = p4.replace(classRegex, `class="$1 ${className}"`);
        return p1 + p2 + p4;
    } else {
        // No class attribute found, add one
        return p1 + p2 + ` class="${className}"` + p4;
    }
});

if (extractedStyles.length > 0) {
    const styleBlock = `\n  <style>\n    ${extractedStyles.join('\n    ')}\n  </style>\n</head>`;
    html = html.replace('</head>', styleBlock);
}

fs.writeFileSync('index.html', html);
console.log(`Extracted ${extractedStyles.length} inline styles.`);
