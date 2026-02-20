/* ============================================
   PREMIERE SYNC - ADMIN DASHBOARD JS
   ============================================ */

const API_BASE = '';  // Same origin

// State
let authCredentials = null;

// ============================================
// AUTH
// ============================================

async function login(username, password) {
    try {
        const response = await fetch(`${API_BASE}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            authCredentials = btoa(`${username}:${password}`);
            showDashboard();
            loadDashboardData();
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('Login error:', error);
        return false;
    }
}

function logout() {
    authCredentials = null;
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('password').value = '';
}

function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authCredentials}`
    };
}

// ============================================
// API CALLS
// ============================================

async function fetchStats() {
    const response = await fetch(`${API_BASE}/api/stats`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

async function fetchKeys() {
    const response = await fetch(`${API_BASE}/api/keys`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

async function fetchActivity() {
    const response = await fetch(`${API_BASE}/api/activity`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

async function fetchLocks() {
    const response = await fetch(`${API_BASE}/api/projects/locks`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

async function generateKey(editorName, expiresInDays) {
    const response = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ editorName, expiresInDays })
    });
    return response.json();
}

async function revokeKey(key) {
    const response = await fetch(`${API_BASE}/api/keys/${key}/revoke`, {
        method: 'POST',
        headers: getAuthHeaders()
    });
    return response.json();
}

async function extendKey(key, days) {
    const response = await fetch(`${API_BASE}/api/keys/${key}/extend`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ days })
    });
    return response.json();
}

async function deleteKey(key) {
    const response = await fetch(`${API_BASE}/api/keys/${key}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });
    return response.json();
}

async function changePassword(newPassword) {
    const response = await fetch(`${API_BASE}/api/admin/change-password`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ newPassword })
    });
    return response.json();
}

async function fetchProjects() {
    const response = await fetch(`${API_BASE}/api/projects`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

async function fetchProjectFiles(projectName) {
    const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectName)}/files`, {
        headers: getAuthHeaders()
    });
    return response.json();
}

// ============================================
// UI RENDERING
// ============================================

async function loadDashboardData() {
    await Promise.all([
        loadStats(),
        loadKeys(),
        loadActivity(),
        loadLocks(),
        loadProjects()
    ]);
}

async function loadStats() {
    try {
        const stats = await fetchStats();
        document.getElementById('stat-total-keys').textContent = stats.totalKeys;
        document.getElementById('stat-active-today').textContent = stats.activeToday;
        document.getElementById('stat-syncs').textContent = stats.todaySyncs;
        document.getElementById('stat-expiring').textContent = stats.expiringKeys;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadKeys() {
    try {
        const keys = await fetchKeys();
        const tbody = document.getElementById('keys-table-body');

        if (keys.length === 0) {
            tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">
            No API keys yet. Click "Generate New Key" to create one.
          </td>
        </tr>
      `;
            return;
        }

        tbody.innerHTML = keys.map(key => {
            const status = getKeyStatus(key);
            const lastUsed = key.last_used
                ? formatDate(key.last_used)
                : '<span style="color: var(--text-muted)">Never</span>';

            return `
        <tr>
          <td><code>${key.key}</code></td>
          <td>${escapeHtml(key.editor_name)}</td>
          <td>${formatDate(key.created_at)}</td>
          <td>${formatDate(key.expires_at)}</td>
          <td>${lastUsed}</td>
          <td><span class="status ${status.class}">${status.icon} ${status.label}</span></td>
          <td>
            <div class="action-buttons">
              ${!key.revoked ? `
                <button class="action-btn" onclick="handleExtendKey('${key.key}')">+30 days</button>
                <button class="action-btn danger" onclick="handleRevokeKey('${key.key}')">Revoke</button>
              ` : `
                <button class="action-btn" onclick="handleExtendKey('${key.key}')">Restore</button>
              `}
              <button class="action-btn danger" onclick="handleDeleteKey('${key.key}')">Delete</button>
            </div>
          </td>
        </tr>
      `;
        }).join('');
    } catch (error) {
        console.error('Error loading keys:', error);
    }
}

async function loadActivity() {
    try {
        const logs = await fetchActivity();
        const tbody = document.getElementById('activity-table-body');

        if (logs.length === 0) {
            tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px;">
            No activity yet.
          </td>
        </tr>
      `;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            const actionClass = getActionClass(log.action);
            return `
        <tr>
          <td>${formatDateTime(log.timestamp)}</td>
          <td>${escapeHtml(log.editor_name)}</td>
          <td><span class="action-label ${actionClass}">${log.action.toUpperCase()}</span></td>
          <td>${log.project_name ? escapeHtml(log.project_name) : '-'}</td>
        </tr>
      `;
        }).join('');
    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

async function loadLocks() {
    try {
        const locks = await fetchLocks();
        const tbody = document.getElementById('locks-table-body');

        if (locks.length === 0) {
            tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px;">
            No projects are currently locked.
          </td>
        </tr>
      `;
            return;
        }

        tbody.innerHTML = locks.map(lock => `
      <tr>
        <td><strong>${escapeHtml(lock.project_name)}</strong></td>
        <td>${escapeHtml(lock.locked_by)}</td>
        <td>${formatDateTime(lock.locked_at)}</td>
        <td>
          <button class="action-btn danger" onclick="handleForceUnlock('${escapeHtml(lock.project_name)}')">
            Force Unlock
          </button>
        </td>
      </tr>
    `).join('');
    } catch (error) {
        console.error('Error loading locks:', error);
    }
}

let selectedProject = null;

async function loadProjects() {
    try {
        const projects = await fetchProjects();
        const container = document.getElementById('projects-list');

        if (!projects || projects.length === 0) {
            container.innerHTML = '<p class="empty-state">No projects shared yet</p>';
            return;
        }

        container.innerHTML = projects.map(p => `
            <div class="project-card" data-project="${escapeHtml(p.name)}" onclick="selectProject('${escapeHtml(p.name)}')">
                <div class="project-card-header">
                    <span class="project-card-name">📁 ${escapeHtml(p.name)}</span>
                    <span class="project-card-files">${p.file_count || 0} files</span>
                </div>
                <div class="project-card-meta">
                    By ${escapeHtml(p.uploaded_by)} • ${formatDate(p.updated_at)}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

async function selectProject(projectName) {
    selectedProject = projectName;

    // Update selection UI
    document.querySelectorAll('.project-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.project === projectName) {
            card.classList.add('selected');
        }
    });

    // Load files for this project
    try {
        const files = await fetchProjectFiles(projectName);
        const container = document.getElementById('project-files');

        if (!files || files.length === 0) {
            container.innerHTML = '<p class="empty-state">No files in this project</p>';
            return;
        }

        container.innerHTML = files.map(f => {
            const icon = getFileIcon(f.file_type || f.file_name);
            const size = formatFileSize(f.file_size);
            return `
                <div class="file-item">
                    <div class="file-icon">${icon}</div>
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(f.file_name)}</div>
                        <div class="file-meta">${size} • By ${escapeHtml(f.uploaded_by)} • ${formatDate(f.uploaded_at)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading project files:', error);
    }
}

function getFileIcon(fileType) {
    if (!fileType) return '📄';
    const type = fileType.toLowerCase();
    if (type.includes('prproj')) return '🎬';
    if (type.includes('video') || ['.mp4', '.mov', '.avi', '.mkv'].some(e => type.includes(e))) return '🎥';
    if (type.includes('audio') || ['.mp3', '.wav', '.aac'].some(e => type.includes(e))) return '🎵';
    if (type.includes('image') || ['.jpg', '.png', '.gif', '.psd'].some(e => type.includes(e))) return '🖼️';
    return '📄';
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ============================================
// HELPERS
// ============================================

function getKeyStatus(key) {
    if (key.revoked) {
        return { class: 'status-revoked', label: 'Revoked', icon: '❌' };
    }

    const expiresAt = new Date(key.expires_at);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) {
        return { class: 'status-expired', label: 'Expired', icon: '⏰' };
    }

    if (daysUntilExpiry <= 7) {
        return { class: 'status-expiring', label: `${daysUntilExpiry}d left`, icon: '⚠️' };
    }

    return { class: 'status-active', label: 'Active', icon: '✅' };
}

function getActionClass(action) {
    const classes = {
        push: 'action-push',
        pull: 'action-pull',
        lock: 'action-lock',
        unlock: 'action-unlock'
    };
    return classes[action] || '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// EVENT HANDLERS
// ============================================

async function handleExtendKey(key) {
    if (confirm('Extend this key by 30 days?')) {
        await extendKey(key, 30);
        loadKeys();
        loadStats();
    }
}

async function handleRevokeKey(key) {
    if (confirm('Revoke this API key? The editor will no longer have access.')) {
        await revokeKey(key);
        loadKeys();
        loadStats();
    }
}

async function handleDeleteKey(key) {
    if (confirm('Permanently delete this API key? This cannot be undone.')) {
        await deleteKey(key);
        loadKeys();
        loadStats();
    }
}

async function handleForceUnlock(projectName) {
    if (confirm(`Force unlock "${projectName}"? The editor who locked it will lose their lock.`)) {
        // For admin force unlock, we make a direct API call
        try {
            await fetch(`${API_BASE}/api/projects/force-unlock`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ projectName })
            });
            loadLocks();
        } catch (error) {
            console.error('Error force unlocking:', error);
        }
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
    });
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        const success = await login(username, password);
        if (!success) {
            document.getElementById('login-error').textContent = 'Invalid username or password';
        }
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', logout);

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Generate key button
    document.getElementById('btn-generate-key').addEventListener('click', () => {
        openModal('modal-generate');
    });

    // Generate key form
    document.getElementById('form-generate-key').addEventListener('submit', async (e) => {
        e.preventDefault();
        const editorName = document.getElementById('editor-name').value;
        const days = parseInt(document.getElementById('expires-days').value);

        const result = await generateKey(editorName, days);

        closeModal('modal-generate');
        document.getElementById('generated-key').textContent = result.key;
        openModal('modal-key-created');

        document.getElementById('editor-name').value = '';
        loadKeys();
        loadStats();
    });

    // Copy key button
    document.getElementById('btn-copy-key').addEventListener('click', () => {
        const key = document.getElementById('generated-key').textContent;
        navigator.clipboard.writeText(key);
        document.getElementById('btn-copy-key').textContent = '✓ Copied!';
        setTimeout(() => {
            document.getElementById('btn-copy-key').textContent = '📋 Copy';
        }, 2000);
    });

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => {
        openModal('modal-settings');
    });

    // Change password form
    document.getElementById('form-change-password').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('confirm-password').value;

        if (newPass !== confirmPass) {
            alert('Passwords do not match!');
            return;
        }

        await changePassword(newPass);
        closeModal('modal-settings');
        alert('Password changed! Please login again.');
        logout();
    });

    // Refresh buttons
    document.getElementById('btn-refresh-activity').addEventListener('click', loadActivity);
    document.getElementById('btn-refresh-locks').addEventListener('click', loadLocks);

    // Projects refresh
    const btnRefreshProjects = document.getElementById('btn-refresh-projects');
    if (btnRefreshProjects) {
        btnRefreshProjects.addEventListener('click', loadProjects);
    }

    // Modal close buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAllModals();
            }
        });
    });
});
