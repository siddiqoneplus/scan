const fs = require('fs');
let lines = fs.readFileSync('db.js', 'utf8').split('\n');
let fixed = lines.map(line => {
    let l = line;
    if (l.endsWith('\r$')) l = l.slice(0, -2) + '\r';
    else if (l.endsWith('$')) l = l.slice(0, -1);
    
    // Some lines might end with $\r
    if (l.endsWith('$\r')) l = l.slice(0, -2) + '\r';
    
    // Also strip \r just to be safe and use \n
    return l.replace(/\r/g, '');
});

fs.writeFileSync('db.js', fixed.join('\n'));
console.log('Fixed trailing dollars in db.js');
