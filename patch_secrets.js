const fs = require('fs');
const bcrypt = require('bcryptjs');

// 1. Create .env.example
const envExample = `# Server Configuration
PORT=3000

# MongoDB Configuration
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/smart_attendance?retryWrites=true&w=majority
DB_NAME=smart_attendance

# Authentication Secrets
JWT_SECRET=generate_a_random_secure_string_here

# Optional: Default Admin Credentials (if seeding fresh database)
ADMIN_PASSWORD=change_this_default_admin_password
EMPLOYEE_PASSWORD=change_this_default_employee_password
`;
fs.writeFileSync('.env.example', envExample);
console.log('Created .env.example');

// 2. Patch auth.js (Frontend)
let authJs = fs.readFileSync('js/auth.js', 'utf8');
const oldAuthAdmin = "      password: 'admin123',";
const oldAuthEmp = "      password: 'emp123',";
authJs = authJs.replace(oldAuthAdmin, "");
authJs = authJs.replace(oldAuthEmp, "");
fs.writeFileSync('js/auth.js', authJs);
console.log('Removed hardcoded passwords from auth.js');

// 3. Patch db.js (Backend)
let dbJs = fs.readFileSync('db.js', 'utf8');

// We will replace the passwords in DEFAULT_ACCOUNTS with bcrypt hashes or environment variables.
const adminHash = bcrypt.hashSync('admin123', 10);
const empHash = bcrypt.hashSync('emp123', 10);

// We need to inject process.env logic for seeding!
// Actually, it's easier to just replace the hardcoded strings with env vars or fallback hashes.
dbJs = dbJs.replace("password: 'admin123',", `password: process.env.ADMIN_PASSWORD ? require('bcryptjs').hashSync(process.env.ADMIN_PASSWORD, 10) : '${adminHash}',`);
dbJs = dbJs.replace("password: 'emp123',", `password: process.env.EMPLOYEE_PASSWORD ? require('bcryptjs').hashSync(process.env.EMPLOYEE_PASSWORD, 10) : '${empHash}',`);

fs.writeFileSync('db.js', dbJs);
console.log('Patched db.js with secure default hashes and env var support');

