/**
 * AUTHENTICATION & SESSION MANAGER
 * Handles login/logout, role-based access control, session persistence,
 * and employee account management for the Smart Attendance System.
 * Synchronizes with backend REST API for centralized multi-device account management.
 */

// Intercept fetch to add Authorization header automatically
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  if (typeof url === 'string' && url.startsWith('/api/') && url !== '/api/login') {
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem('smart_attendance_session'));
    } catch(e) {}
    if (session && session.token) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${session.token}`;
    }
  }
  const response = await originalFetch(url, options);
  if (response.status === 401 && url !== '/api/login') {
     localStorage.removeItem('smart_attendance_session');
     if (!window.location.href.includes('login.html')) {
       window.location.href = 'login.html';
     }
  }
  return response;
};

const AuthManager = (() => {
  const SESSION_KEY = 'smart_attendance_session';
  const ACCOUNTS_KEY = 'smart_attendance_accounts';

  // Default accounts (seeded on first load)
  const DEFAULT_ACCOUNTS = [
    {
      username: 'admin',
      password: 'admin123',
      displayName: 'Administrator',
      role: 'admin',
      createdAt: new Date().toISOString()
    },
    {
      username: 'employee',
      password: 'emp123',
      displayName: 'Staff Member',
      role: 'employee',
      createdAt: new Date().toISOString()
    }
  ];

  function init() {
    // Seed default accounts if none exist
    if (!localStorage.getItem(ACCOUNTS_KEY)) {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEFAULT_ACCOUNTS));
    }
    syncFromServer();
  }

  async function syncFromServer() {
    if (!isAdmin()) return; // Only admin needs full account list for UI mapping
    try {
      const response = await fetch('/api/accounts');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.accounts) && data.accounts.length > 0) {
          localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(data.accounts));
        }
      }
    } catch (e) {
      // Offline fallback: keep local accounts
    }
  }

  function getAccounts() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveAccounts(accounts, syncToServer = true) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

    if (syncToServer) {
      fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts })
      }).catch(err => console.warn('Could not sync accounts to server:', err));
    }
  }

  /**
   * Attempt login with username/password via backend API.
   * Returns { success, session?, error? }
   */
  async function login(username, password, rememberMe = false) {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      
      if (data.success) {
        const session = {
          username: data.session.username,
          displayName: data.session.displayName,
          role: data.session.role,
          token: data.token,
          loginTime: new Date().toISOString(),
          rememberMe: rememberMe
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { success: true, session };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (e) {
      return { success: false, error: 'Network error or server unreachable.' };
    }
  }

  /**
   * Log out the current user.
   */
  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  /**
   * Get the current session, or null if not logged in.
   */
  function getSession() {
    try {
      const data = localStorage.getItem(SESSION_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Check if the user is logged in.
   */
  function isLoggedIn() {
    return getSession() !== null;
  }

  /**
   * Get the current user's role ('admin' or 'employee').
   */
  function getRole() {
    const session = getSession();
    return session ? session.role : null;
  }

  /**
   * Check if the current user is an admin.
   */
  function isAdmin() {
    return getRole() === 'admin';
  }

  /**
   * Redirect to login page if not authenticated.
   */
  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }

  /**
   * Admin only: Add a new employee account.
   */
  function addAccount({ username, password, displayName, role = 'employee' }) {
    if (!isAdmin()) throw new Error('Only admins can add accounts.');
    if (!username || !password) throw new Error('Username and password are required.');

    const accounts = getAccounts();
    const exists = accounts.some(a => a.username.toLowerCase() === username.toLowerCase());
    if (exists) throw new Error(`Account "${username}" already exists.`);

    accounts.push({
      username: username.trim().toLowerCase(),
      password,
      displayName: displayName || username,
      role,
      createdAt: new Date().toISOString()
    });

    saveAccounts(accounts, true);
    return true;
  }

  /**
   * Admin only: Delete an account (cannot delete own account).
   */
  function deleteAccount(username) {
    if (!isAdmin()) throw new Error('Only admins can delete accounts.');
    
    const session = getSession();
    if (session.username.toLowerCase() === username.toLowerCase()) {
      throw new Error('Cannot delete your own account.');
    }

    const accounts = getAccounts();
    const filtered = accounts.filter(a => a.username.toLowerCase() !== username.toLowerCase());
    if (filtered.length === accounts.length) {
      throw new Error('Account not found.');
    }

    saveAccounts(filtered, true);
    return true;
  }

  /**
   * Admin only: Get all accounts (passwords masked).
   */
  function listAccounts() {
    return getAccounts().map(a => ({
      username: a.username,
      displayName: a.displayName,
      role: a.role,
      createdAt: a.createdAt
    }));
  }

  /**
   * List employee accounts for assignment dropdowns
   */
  function getEmployeeAccounts() {
    return getAccounts().filter(a => a.role === 'employee').map(a => ({
      username: a.username,
      displayName: a.displayName
    }));
  }

  /**
   * Admin only: Update an account's password or display name.
   */
  function updateAccount(username, updates = {}) {
    if (!isAdmin()) throw new Error('Only admins can update accounts.');

    const accounts = getAccounts();
    const idx = accounts.findIndex(a => a.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) throw new Error('Account not found.');

    if (updates.password) accounts[idx].password = updates.password;
    if (updates.displayName) accounts[idx].displayName = updates.displayName;
    if (updates.role && accounts[idx].username !== 'admin') {
      accounts[idx].role = updates.role;
    }

    saveAccounts(accounts, true);
    return true;
  }

  return {
    init,
    syncFromServer,
    login,
    logout,
    getSession,
    isLoggedIn,
    getRole,
    isAdmin,
    requireAuth,
    addAccount,
    deleteAccount,
    listAccounts,
    getEmployeeAccounts,
    updateAccount
  };
})();
