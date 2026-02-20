const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3847;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new Database(path.join(__dirname, 'sync-data.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    editor_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked INTEGER DEFAULT 0,
    last_used TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT NOT NULL,
    editor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    project_name TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT UNIQUE NOT NULL,
    locked_by TEXT NOT NULL,
    locked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    path TEXT,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    file_type TEXT,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (project_name) REFERENCES projects(name)
  );
`);

// Create default admin if not exists (username: admin, password: admin123)
const adminExists = db.prepare('SELECT * FROM admin WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('Default admin created - username: admin, password: admin123');
}

// ============== AUTH MIDDLEWARE ==============
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const base64 = authHeader.split(' ')[1];
  const [username, password] = Buffer.from(base64, 'base64').toString().split(':');

  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  next();
}

// ============== ADMIN API ROUTES ==============

// Login check
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ success: true, message: 'Login successful' });
});

// Change admin password
app.post('/api/admin/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin SET password_hash = ? WHERE username = ?').run(hash, 'admin');
  res.json({ success: true });
});

// Generate new API key
app.post('/api/keys', requireAuth, (req, res) => {
  const { editorName, expiresInDays = 30 } = req.body;

  const key = `PSE-${uuidv4().substring(0, 8).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO api_keys (key, editor_name, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(key, editorName, createdAt, expiresAt);

  res.json({ key, editorName, createdAt, expiresAt });
});

// Get all API keys
app.get('/api/keys', requireAuth, (req, res) => {
  const keys = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all();
  res.json(keys);
});

// Revoke API key
app.post('/api/keys/:key/revoke', requireAuth, (req, res) => {
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE key = ?').run(req.params.key);
  res.json({ success: true });
});

// Extend API key
app.post('/api/keys/:key/extend', requireAuth, (req, res) => {
  const { days = 30 } = req.body;
  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(req.params.key);

  if (!key) {
    return res.status(404).json({ error: 'Key not found' });
  }

  const currentExpiry = new Date(key.expires_at);
  const newExpiry = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);

  db.prepare('UPDATE api_keys SET expires_at = ?, revoked = 0 WHERE key = ?')
    .run(newExpiry.toISOString(), req.params.key);

  res.json({ success: true, newExpiresAt: newExpiry.toISOString() });
});

// Delete API key
app.delete('/api/keys/:key', requireAuth, (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE key = ?').run(req.params.key);
  res.json({ success: true });
});

// Get activity log
app.get('/api/activity', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM activity_log 
    ORDER BY timestamp DESC 
    LIMIT 100
  `).all();
  res.json(logs);
});

// Get dashboard stats
app.get('/api/stats', requireAuth, (req, res) => {
  const totalKeys = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE revoked = 0').get();
  const activeToday = db.prepare(`
    SELECT COUNT(DISTINCT api_key) as count FROM activity_log 
    WHERE date(timestamp) = date('now')
  `).get();
  const expiringKeys = db.prepare(`
    SELECT COUNT(*) as count FROM api_keys 
    WHERE revoked = 0 AND expires_at < datetime('now', '+7 days')
  `).get();
  const todaySyncs = db.prepare(`
    SELECT COUNT(*) as count FROM activity_log 
    WHERE date(timestamp) = date('now') AND action IN ('push', 'pull')
  `).get();
  const lockedProjects = db.prepare('SELECT COUNT(*) as count FROM project_locks').get();

  res.json({
    totalKeys: totalKeys.count,
    activeToday: activeToday.count,
    expiringKeys: expiringKeys.count,
    todaySyncs: todaySyncs.count,
    lockedProjects: lockedProjects.count
  });
});

// ============== EDITOR API ROUTES (Used by Extension) ==============

// Validate API key
app.post('/api/validate', (req, res) => {
  const { apiKey } = req.body;

  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(apiKey);

  if (!key) {
    return res.json({ valid: false, error: 'Invalid API key' });
  }

  if (key.revoked) {
    return res.json({ valid: false, error: 'API key has been revoked' });
  }

  if (new Date(key.expires_at) < new Date()) {
    return res.json({ valid: false, error: 'API key has expired' });
  }

  // Update last used
  db.prepare('UPDATE api_keys SET last_used = ? WHERE key = ?')
    .run(new Date().toISOString(), apiKey);

  res.json({ valid: true, editorName: key.editor_name, expiresAt: key.expires_at });
});

// Log activity
app.post('/api/activity', (req, res) => {
  const { apiKey, action, projectName } = req.body;

  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(apiKey);
  if (!key) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  db.prepare(`
    INSERT INTO activity_log (api_key, editor_name, action, project_name, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(apiKey, key.editor_name, action, projectName, new Date().toISOString());

  res.json({ success: true });
});

// Lock project
app.post('/api/projects/lock', (req, res) => {
  const { apiKey, projectName } = req.body;

  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(apiKey);
  if (!key || key.revoked) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const existingLock = db.prepare('SELECT * FROM project_locks WHERE project_name = ?').get(projectName);
  if (existingLock) {
    return res.json({
      success: false,
      error: `Project is locked by ${existingLock.locked_by}`,
      lockedBy: existingLock.locked_by,
      lockedAt: existingLock.locked_at
    });
  }

  db.prepare(`
    INSERT INTO project_locks (project_name, locked_by, locked_at)
    VALUES (?, ?, ?)
  `).run(projectName, key.editor_name, new Date().toISOString());

  res.json({ success: true });
});

// Unlock project
app.post('/api/projects/unlock', (req, res) => {
  const { apiKey, projectName } = req.body;

  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(apiKey);
  if (!key) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const lock = db.prepare('SELECT * FROM project_locks WHERE project_name = ?').get(projectName);
  if (lock && lock.locked_by !== key.editor_name) {
    return res.json({ success: false, error: 'You do not own this lock' });
  }

  db.prepare('DELETE FROM project_locks WHERE project_name = ?').run(projectName);
  res.json({ success: true });
});

// Get project locks
app.get('/api/projects/locks', (req, res) => {
  const locks = db.prepare('SELECT * FROM project_locks').all();
  res.json(locks);
});

// Force unlock project (admin only)
app.post('/api/projects/force-unlock', requireAuth, (req, res) => {
  const { projectName } = req.body;
  db.prepare('DELETE FROM project_locks WHERE project_name = ?').run(projectName);
  res.json({ success: true });
});

// ============== PROJECTS API ==============

// Get all shared projects (with file counts)
app.get('/api/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, 
           (SELECT COUNT(*) FROM project_files WHERE project_name = p.name) as file_count
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all();
  res.json(projects);
});

// Get files for a specific project
app.get('/api/projects/:name/files', (req, res) => {
  const files = db.prepare(`
    SELECT * FROM project_files 
    WHERE project_name = ?
    ORDER BY uploaded_at DESC
  `).all(req.params.name);
  res.json(files);
});

// Register/update a project with files
app.post('/api/projects/register', (req, res) => {
  const { apiKey, projectName, projectPath, files } = req.body;

  const key = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(apiKey);
  if (!key || key.revoked) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const now = new Date().toISOString();

  // Check if project exists
  const existing = db.prepare('SELECT * FROM projects WHERE name = ?').get(projectName);

  if (existing) {
    // Update existing project
    db.prepare(`
      UPDATE projects 
      SET path = ?, uploaded_by = ?, updated_at = ?
      WHERE name = ?
    `).run(projectPath, key.editor_name, now, projectName);
  } else {
    // Insert new project
    db.prepare(`
      INSERT INTO projects (name, path, uploaded_by, uploaded_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectName, projectPath, key.editor_name, now, now);
  }

  // Handle associated files
  if (files && Array.isArray(files) && files.length > 0) {
    const insertFile = db.prepare(`
      INSERT INTO project_files 
      (project_name, file_name, file_path, file_size, file_type, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      try {
        insertFile.run(
          projectName,
          file.name,
          file.path || '',
          file.size || 0,
          file.type || file.extension || '',
          key.editor_name,
          now
        );
      } catch (e) {
        console.log('File insert error:', e.message);
      }
    }
  }

  res.json({ success: true, projectName, filesAdded: files ? files.length : 0 });
});

// Get all project files (for admin dashboard)
app.get('/api/files', requireAuth, (req, res) => {
  const files = db.prepare(`
    SELECT pf.*, p.uploaded_by as project_owner
    FROM project_files pf
    JOIN projects p ON pf.project_name = p.name
    ORDER BY pf.uploaded_at DESC
    LIMIT 100
  `).all();
  res.json(files);
});

// Get sync state (for checking updates)
app.get('/api/sync-state', (req, res) => {
  const recentActivity = db.prepare(`
    SELECT * FROM activity_log 
    WHERE action = 'push' 
    ORDER BY timestamp DESC 
    LIMIT 20
  `).all();

  const locks = db.prepare('SELECT * FROM project_locks').all();

  res.json({ recentPushes: recentActivity, locks });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Premiere Sync Server running at http://localhost:${PORT}`);
  console.log(`📊 Admin Dashboard: http://localhost:${PORT}`);
  console.log(`\n🔐 Default login: admin / admin123`);
  console.log(`   (Change this after first login!)\n`);
});
