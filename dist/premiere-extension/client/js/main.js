/* ============================================
   PREMIERE SYNC - MAIN UI LOGIC
   ============================================ */

// DOM Elements
const elements = {
    // Screens
    activationScreen: document.getElementById('activation-screen'),
    mainPanel: document.getElementById('main-panel'),

    // Auth - Device Flow
    authConnect: document.getElementById('auth-connect'),
    authDeviceCode: document.getElementById('auth-device-code'),
    btnGoogleConnect: document.getElementById('btn-google-connect'),
    btnCancelAuth: document.getElementById('btn-cancel-auth'),
    verificationUrl: document.getElementById('verification-url'),
    deviceCode: document.getElementById('device-code'),
    authStatus: document.getElementById('auth-status'),
    activationError: document.getElementById('activation-error'),

    // Header
    editorNameDisplay: document.getElementById('display-editor-name'),
    btnSettings: document.getElementById('btn-settings'),

    // Status
    syncStatus: document.getElementById('sync-status'),
    statusText: document.getElementById('status-text'),
    lastCheck: document.getElementById('last-check'),

    // Current Project
    currentProjectCard: document.getElementById('current-project-card'),
    btnRefreshCurrent: document.getElementById('btn-refresh-current'),

    // Folder
    folderPath: document.getElementById('folder-path'),
    btnBrowseFolder: document.getElementById('btn-browse-folder'),
    btnEditPath: document.getElementById('btn-edit-path'),
    folderInputSection: document.getElementById('folder-input-section'),
    folderPathInput: document.getElementById('folder-path-input'),
    btnSavePath: document.getElementById('btn-save-path'),

    // Projects
    projectsList: document.getElementById('projects-list'),
    btnRefresh: document.getElementById('btn-refresh'),

    // Actions
    btnPush: document.getElementById('btn-push'),
    btnAddFile: document.getElementById('btn-add-file'),

    // Modals
    modalSettings: document.getElementById('modal-settings'),
    modalProject: document.getElementById('modal-project'),

    settingsEditorName: document.getElementById('settings-editor-name'),
    settingsServerUrl: document.getElementById('settings-server-url'),
    settingsExpires: document.getElementById('settings-expires'),
    btnDeactivate: document.getElementById('btn-deactivate')
};

// State
let currentProject = null;
let teamProjects = [];
let projectLocks = {};
let pendingFilesToPush = [];
let isPushing = false;
let isPulling = false;

/* ============================================
   INITIALIZATION
   ============================================ */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Listeners FIRST so buttons work even if other stuff fails
    setupEventListeners();

    // 2. Load Config
    try {
        Config.load();
    } catch (e) {
        console.error('Config load error:', e);
        debugLog('Config load error: ' + e.message, 'error');
    }

    // 3. Force panel width (workaround for CEP caching)
    try {
        if (typeof FileSystem !== 'undefined' && FileSystem.csInterface) {
            FileSystem.csInterface.resizeContent(500, 600);
            console.log('Panel resized to 500x600');
        }
    } catch (e) {
        console.log('Could not resize panel:', e);
    }

    // 4. Check for OAuth authentication
    const authStatus = document.getElementById('auth-status');
    const authDetail = document.getElementById('auth-detail');

    try {
        // Check if user is already authenticated
        const isAuth = await GoogleDrive.isAuthenticated();

        if (isAuth) {
            // User has valid token, show main panel
            if (authStatus) authStatus.textContent = '✅ Connected to Google Drive';
            if (authDetail) authDetail.textContent = 'Loading...';

            setTimeout(() => {
                showMainPanel();
                initializeSync();
            }, 1000);
        } else {
            // Show activation screen for login
            if (authStatus) authStatus.textContent = 'Connect to Google Drive';
            if (authDetail) authDetail.textContent = 'Click the button below to get started';
        }
    } catch (error) {
        console.error('Auth check error:', error);
        if (authStatus) authStatus.textContent = 'Connect to Google Drive';
        if (authDetail) authDetail.textContent = 'Click the button below to get started';
        debugLog('Auth check error: ' + error.message, 'error');
    }
});

// Debug Log Helper
function debugLog(message, type = 'info') {
    // Log to console
    console.log(message);

    // Log to UI panel
    const logContent = document.getElementById('debug-log-content');
    if (logContent) {
        const timestamp = new Date().toLocaleTimeString();
        const color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#51cf66' : '#aaa';
        const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '🔹';
        logContent.innerHTML += `<div style="color: ${color}; margin-bottom: 4px;">[${timestamp}] ${icon} ${message}</div>`;
        // Auto-scroll to bottom
        const panel = document.getElementById('debug-log-panel');
        if (panel) panel.scrollTop = panel.scrollHeight;
    }
}

function setupEventListeners() {
    // OAuth buttons
    const btnGoogleConnect = document.getElementById('btn-google-connect');
    const btnCancelAuth = document.getElementById('btn-cancel-auth');

    debugLog('Setting up OAuth buttons...');
    debugLog(`btnGoogleConnect: ${btnGoogleConnect ? 'Found ✓' : 'NOT FOUND'}`, btnGoogleConnect ? 'success' : 'error');
    debugLog(`btnCancelAuth: ${btnCancelAuth ? 'Found ✓' : 'NOT FOUND'}`, btnCancelAuth ? 'success' : 'error');

    if (btnGoogleConnect) {
        debugLog('Adding click listener to Google Connect button', 'success');
        btnGoogleConnect.addEventListener('click', () => {
            debugLog('🖱️ Google Connect button CLICKED!', 'success');
            handleGoogleConnect();
        });
    } else {
        debugLog('Google Connect button NOT FOUND in DOM!', 'error');
    }
    if (btnCancelAuth) {
        btnCancelAuth.addEventListener('click', handleCancelAuth);
    }

    // Test auth button (deprecated, kept for compatibility)
    const btnTestAuth = document.getElementById('btn-test-auth');
    if (btnTestAuth) {
        btnTestAuth.addEventListener('click', async () => {
            btnTestAuth.disabled = true;
            btnTestAuth.textContent = 'Running tests...';
            try {
                await testServiceAccountAuth();
                alert('✅ Tests completed! Check console for results.');
            } catch (e) {
                alert('❌ Tests failed: ' + e.message);
            } finally {
                btnTestAuth.disabled = false;
                btnTestAuth.textContent = 'Run Diagnostic Test';
            }
        });
    }

    // Settings
    elements.btnSettings.addEventListener('click', () => openModal('modal-settings'));
    elements.btnDeactivate.addEventListener('click', handleLogout);

    // Current project refresh
    elements.btnRefreshCurrent.addEventListener('click', refreshCurrentProject);

    // Folder browsing
    elements.btnBrowseFolder.addEventListener('click', handleBrowseFolder);
    elements.btnEditPath.addEventListener('click', toggleFolderInput);
    elements.btnSavePath.addEventListener('click', saveFolderPath);

    // Allow Enter key in folder input
    elements.folderPathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveFolderPath();
        }
    });

    // Refresh projects
    elements.btnRefresh.addEventListener('click', refreshTeamProjects);

    // Push current project
    elements.btnPush.addEventListener('click', handlePushCurrent);

    // Push scope toggle (default: timeline-only)
    const includeProjectMediaToggle = document.getElementById('toggle-include-project-media');
    if (includeProjectMediaToggle) {
        includeProjectMediaToggle.checked = !!Config.data.includeProjectMediaOnPush;
        includeProjectMediaToggle.addEventListener('change', (e) => {
            Config.data.includeProjectMediaOnPush = !!e.target.checked;
            Config.save();
            console.log(`Push scope: ${Config.data.includeProjectMediaOnPush ? 'all project media' : 'timeline only'}`);
            updateFilesScopeLabel();
        });
    }

    // Add project
    elements.btnAddFile.addEventListener('click', handleAddProject);

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Close modal on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAllModals();
        });
    });

    // File selection modal handlers
    const btnSelectAll = document.getElementById('btn-select-all');
    const btnSelectNone = document.getElementById('btn-select-none');
    const btnPushSelected = document.getElementById('btn-push-selected');

    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => toggleAllFileSelection(true));
    }
    if (btnSelectNone) {
        btnSelectNone.addEventListener('click', () => toggleAllFileSelection(false));
    }
    if (btnPushSelected) {
        btnPushSelected.addEventListener('click', handlePushSelectedFiles);
    }

    // Cancel Download button
    const btnCancelDownload = document.getElementById('btn-cancel-download');
    if (btnCancelDownload) {
        btnCancelDownload.addEventListener('click', () => {
            if (downloadContext) {
                downloadContext.cancelled = true;
                console.log('Download cancellation requested');
            }
        });
    }

    // Project Explorer Modal - Close buttons
    const explorerModal = document.getElementById('modal-project-explorer');
    if (explorerModal) {
        const downloadIndicator = document.getElementById('download-indicator');

        const closeButtons = explorerModal.querySelectorAll('.btn-close-modal');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                explorerModal.classList.add('hidden');
                // Show floating indicator if pull is in progress
                if (isPulling && downloadIndicator) {
                    downloadIndicator.classList.remove('hidden');
                }
            });
        });

        // Backdrop click handler - hide modal but show indicator if pulling
        explorerModal.addEventListener('click', (e) => {
            if (e.target === explorerModal) {
                explorerModal.classList.add('hidden');
                if (isPulling && downloadIndicator) {
                    downloadIndicator.classList.remove('hidden');
                }
            }
        });

        // Refresh button
        const refreshBtn = document.getElementById('btn-refresh-explorer');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                // Get current project info from modal title
                const titleSpan = document.getElementById('explorer-project-name');
                const projectName = titleSpan ? titleSpan.textContent : '';

                // Find the project in teamProjects to get the ID
                const project = teamProjects.find(p => p.name === projectName);
                if (project) {
                    handlePullProject(project.id, projectName);
                }
            });
        }
    }
}

/* ============================================
   DEBUG CONSOLE
   ============================================ */

// Capture all console.log calls
const debugLogs = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = function (...args) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    debugLogs.push(`[LOG] ${message}`);
    updateDebugOutput();
    originalConsoleLog.apply(console, args);
};

console.warn = function (...args) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    debugLogs.push(`[WARN] ${message}`);
    updateDebugOutput();
    originalConsoleWarn.apply(console, args);
};

console.error = function (...args) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    debugLogs.push(`[ERROR] ${message}`);
    updateDebugOutput();
    originalConsoleError.apply(console, args);
};

function updateDebugOutput() {
    const output = document.getElementById('debug-output');
    if (output) {
        output.value = debugLogs.join('\n');
        output.scrollTop = output.scrollHeight; // Auto scroll to bottom
    }
}

function toggleDebugConsole() {
    const panel = document.getElementById('debug-panel');
    const toggle = document.getElementById('debug-toggle');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        toggle.textContent = '▲';
    } else {
        panel.classList.add('hidden');
        toggle.textContent = '▼';
    }
}

function copyDebugLogs() {
    const output = document.getElementById('debug-output');
    output.select();
    document.execCommand('copy');
    alert('✅ Debug logs copied to clipboard!');
}

function clearDebugLogs() {
    debugLogs.length = 0;
    updateDebugOutput();
}

/* ============================================
   SCREENS
   ============================================ */

function showActivationScreen() {
    elements.activationScreen.classList.remove('hidden');
    elements.mainPanel.classList.add('hidden');
    // Reset auth UI
    if (elements.authConnect) elements.authConnect.classList.remove('hidden');
    if (elements.authDeviceCode) elements.authDeviceCode.classList.add('hidden');
}

function showMainPanel() {
    elements.activationScreen.classList.add('hidden');
    elements.mainPanel.classList.remove('hidden');

    // Update UI with OAuth user info
    elements.editorNameDisplay.textContent = Config.data.editorName || 'Editor';
    updateFolderDisplay();

    // Settings modal info
    if (elements.settingsEditorName) {
        elements.settingsEditorName.textContent = Config.data.editorName || 'OAuth User';
    }
    if (elements.settingsServerUrl) {
        elements.settingsServerUrl.textContent = 'Google Drive (OAuth)';
    }

    const includeProjectMediaToggle = document.getElementById('toggle-include-project-media');
    if (includeProjectMediaToggle) {
        includeProjectMediaToggle.checked = !!Config.data.includeProjectMediaOnPush;
    }
    updateFilesScopeLabel();
}

/* ============================================
   GOOGLE DRIVE AUTHENTICATION
   ============================================ */

async function handleGoogleConnect() {
    try {
        elements.activationError.textContent = '';
        elements.btnGoogleConnect.disabled = true;
        elements.btnGoogleConnect.textContent = 'Opening browser...';
        debugLog('🔐 Starting Google Drive connection...', 'info');

        // Start loopback auth (opens browser, waits for redirect)
        await GoogleDrive.startLoopbackAuth();

        // Success!
        debugLog('✅ Connected to Google Drive!', 'success');
        showMainPanel();
        initializeSync();

    } catch (error) {
        console.error('Google connect error:', error);
        debugLog('❌ Auth error: ' + error.message, 'error');
        elements.activationError.textContent = error.message;
        elements.btnGoogleConnect.disabled = false;
        elements.btnGoogleConnect.innerHTML = '<span>☁️</span> Connect Google Drive';
    }
}

function handleCancelAuth() {
    GoogleDrive.cancelAuth();
    showActivationScreen();
    elements.btnGoogleConnect.disabled = false;
    elements.btnGoogleConnect.innerHTML = '<span>☁️</span> Connect Google Drive';
}

function handleLogout() {
    GoogleDrive.logout();
    Config.clear();
    showActivationScreen();
    closeAllModals();
}

/* ============================================
   PROJECT INITIALIZATION
   ============================================ */

async function handleInitializeProject() {
    if (!currentProject) {
        alert('No project detected in Premiere.\\n\\nOpen a project first, then click Initialize.');
        return;
    }

    // Check if already initialized
    // For now, prompt for confirmation
    const shouldInit = confirm(
        `Initialize "${currentProject.name}" for Team Sync?\\n\\n` +
        `This will:\\n` +
        `• Create sync files in the project folder\\n` +
        `• Make the project visible to your team\\n\\n` +
        `Continue?`
    );

    if (!shouldInit) return;

    try {
        // Get the project folder (parent of .prproj file)
        const projectPath = currentProject.path;
        const folderPath = FileSystem.getDirname(projectPath);

        // TODO: Convert local path to Google Drive folder ID
        // For now, we'll use the sync folder
        if (!Config.data.syncFolder) {
            alert('Please set a sync folder first (Browse button).');
            return;
        }

        // For MVP: copy project to sync folder and initialize there
        alert(
            `MVP Mode:\\n\\n` +
            `1. Copy your project folder to: ${Config.data.syncFolder}\\n` +
            `2. The extension will track it from there\\n\\n` +
            `Full Google Drive integration coming soon!`
        );

    } catch (error) {
        console.error('Initialize error:', error);
        alert('Error initializing project: ' + error.message);
    }
}

/* ============================================
   SYNC INITIALIZATION
   ============================================ */

async function initializeSync() {
    updateConnectionStatus(true);

    // Load current project from Premiere
    await refreshCurrentProject();

    // Load team projects from server
    await refreshTeamProjects();

    // Start periodic checks
    SyncEngine.startPeriodicCheck((state) => {
        if (state) {
            handleSyncState(state);
        }
        updateLastCheckTime();
    });
}

function handleSyncState(state) {
    // Update locks
    projectLocks = {};
    if (state.locks) {
        state.locks.forEach(lock => {
            projectLocks[lock.project_name] = lock;
        });
    }

    // Re-render projects with lock info
    renderTeamProjects();
}

/* ============================================
   FOLDER MANAGEMENT
   ============================================ */

function updateFolderDisplay() {
    if (Config.data.syncFolder) {
        elements.folderPath.textContent = Config.data.syncFolder;
        elements.folderPath.classList.remove('placeholder');
    } else {
        elements.folderPath.textContent = 'Click Browse or ✏️ to set path';
        elements.folderPath.classList.add('placeholder');
    }
}

function toggleFolderInput() {
    const isHidden = elements.folderInputSection.classList.contains('hidden');

    if (isHidden) {
        // Show input
        elements.folderInputSection.classList.remove('hidden');
        elements.folderPathInput.value = Config.data.syncFolder || '';
        elements.folderPathInput.focus();
    } else {
        // Hide input
        elements.folderInputSection.classList.add('hidden');
    }
}

function saveFolderPath() {
    const path = elements.folderPathInput.value.trim();

    if (path) {
        Config.data.syncFolder = path;
        Config.save();
        updateFolderDisplay();
        elements.folderInputSection.classList.add('hidden');
    }
}

async function handleBrowseFolder() {
    console.log('Browse folder clicked');

    try {
        const folder = await FileSystem.selectFolder();
        console.log('Selected folder:', folder);

        if (folder) {
            Config.data.syncFolder = folder;
            Config.save();
            updateFolderDisplay();

            // Auto-detect .prproj files in the folder
            await scanSyncFolderForProjects(folder);
        }
    } catch (error) {
        console.error('Error selecting folder:', error);
        // Show manual input on error
        toggleFolderInput();
    }
}

// Scan sync folder for .prproj files
async function scanSyncFolderForProjects(folderPath) {
    const projectFiles = FileSystem.getProjectFiles(folderPath);

    if (projectFiles && projectFiles.length > 0) {
        const names = projectFiles.map(f => f.name).join('\n- ');
        const shouldImport = confirm(
            `Found ${projectFiles.length} project file(s) in folder:\n- ${names}\n\nWould you like to register them with the server?`
        );

        if (shouldImport) {
            for (const file of projectFiles) {
                await SyncEngine.registerProject(file.name, file.path);
                await SyncEngine.logActivity('push', file.name);
            }
            await refreshTeamProjects();
            alert(`✅ Registered ${projectFiles.length} project(s)!`);
        }
    }
}

/* ============================================
   CURRENT PROJECT
   ============================================ */

async function refreshCurrentProject() {
    console.log('Refreshing current project...');

    try {
        const projectInfo = await FileSystem.getCurrentProjectInfo();
        console.log('Project info:', projectInfo);

        if (projectInfo && projectInfo.name) {
            currentProject = projectInfo;

            // AUTO-SET sync folder to project's directory
            if (projectInfo.path) {
                const projectFolder = FileSystem.getDirname(projectInfo.path);
                if (projectFolder && projectFolder !== Config.data.syncFolder) {
                    Config.data.syncFolder = projectFolder;
                    Config.save();
                    updateFolderDisplay();
                    console.log('Auto-set sync folder to:', projectFolder);
                }
            }

            renderCurrentProject();
        } else {
            currentProject = null;
            elements.currentProjectCard.innerHTML = `
        <div class="empty-state small">
          <p>No project open in Premiere</p>
          <p class="hint">Open a project to push it</p>
        </div>
      `;
        }
    } catch (error) {
        console.error('Error getting project:', error);
        currentProject = null;
        elements.currentProjectCard.innerHTML = `
      <div class="empty-state small">
        <p>Could not detect project</p>
        <p class="hint">Use "Add Project" to select manually</p>
      </div>
    `;
    }
}

function renderCurrentProject() {
    if (!currentProject) return;

    const lock = projectLocks[currentProject.name];
    const isLocked = lock && lock.locked_by !== Config.data.editorName;

    elements.currentProjectCard.innerHTML = `
    <div class="project-item current">
      <div class="project-icon">📽️</div>
      <div class="project-info">
        <div class="project-name">${escapeHtml(currentProject.name)}</div>
        <div class="project-meta">
          ${currentProject.modified === 'Yes' ? '⚠️ Unsaved changes' : '✓ Saved'}
        </div>
      </div>
      ${isLocked ? `<span class="project-status locked">🔒 ${lock.locked_by}</span>` : ''}
    </div>
  `;
}

/* ============================================
   TEAM PROJECTS
   ============================================ */

async function refreshTeamProjects() {
    try {
        if (!GoogleDrive.isAuthenticated()) {
            teamProjects = [];
            renderTeamProjects();
            return;
        }

        const driveProjects = await GoogleDrive.listProjects(GoogleDriveConfig.teamProjectsFolderId);
        teamProjects = driveProjects.map(p => ({
            name: p.name,
            uploaded_by: 'Google Drive',
            updated_at: p.modifiedTime,
            path: '',
            id: p.id
        }));
        renderTeamProjects();
    } catch (error) {
        console.error('Error refreshing projects:', error);
    }
}

function renderTeamProjects() {
    if (!teamProjects || teamProjects.length === 0) {
        elements.projectsList.innerHTML = `
      <div class="empty-state">
        <p>No projects shared yet</p>
        <p class="hint">Push a project to share with team</p>
      </div>
    `;
        return;
    }

    elements.projectsList.innerHTML = teamProjects.map(project => {
        const lock = projectLocks[project.name];
        const isLockedByMe = lock && lock.locked_by === Config.data.editorName;
        const isLockedByOther = lock && lock.locked_by !== Config.data.editorName;

        let statusHtml = '';
        if (isLockedByOther) {
            statusHtml = `<span class="project-status locked">🔒 ${escapeHtml(lock.locked_by)}</span>`;
        } else if (isLockedByMe) {
            statusHtml = `<span class="project-status editing">✏️ You</span>`;
        }

        return `
      <div class="project-item" data-project="${escapeHtml(project.name)}" data-id="${escapeHtml(project.id)}" data-path="${escapeHtml(project.path || '')}">
        <div class="project-icon">📁</div>
        <div class="project-info">
          <div class="project-name">${escapeHtml(project.name)}</div>
          <div class="project-meta">
            By ${escapeHtml(project.uploaded_by || 'Unknown')} • ${formatDate(project.updated_at)}
          </div>
        </div>
        ${statusHtml}
        <button class="btn-icon btn-pull" title="Pull project" data-project-id="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}">↓</button>
      </div>
    `;
    }).join('');

    // Add click handlers for project items
    elements.projectsList.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', async () => {
            const projectId = item.dataset.id; // Drive folder ID
            const projectName = item.dataset.project;
            await handlePullProject(projectId, projectName);
        });
    });

    // Add Pull button handlers (prevent propagation to parent)
    elements.projectsList.querySelectorAll('.btn-pull').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Don't trigger project item click
            const projectId = btn.dataset.projectId;
            const projectName = btn.dataset.projectName;
            await handlePullProject(projectId, projectName);
        });
    });
}

function showProjectOptions(projectName, projectPath) {
    const project = teamProjects.find(p => p.name === projectName);
    const lock = projectLocks[projectName];
    const isLockedByMe = lock && lock.locked_by === Config.data.editorName;
    const isLockedByOther = lock && lock.locked_by !== Config.data.editorName;

    document.getElementById('project-modal-title').textContent = projectName;

    let content = `<p style="margin-bottom: 16px; color: var(--text-secondary);">`;
    if (project) {
        content += `Shared by ${escapeHtml(project.uploaded_by || 'Unknown')}<br>`;
        content += `Last updated: ${formatDate(project.updated_at)}`;
    }
    content += `</p>`;

    content += `<div class="modal-buttons">`;

    if (isLockedByOther) {
        content += `<p style="color: var(--warning); margin-bottom: 12px;">🔒 Locked by ${escapeHtml(lock.locked_by)}</p>`;
        content += `<button class="btn btn-secondary" disabled>Cannot edit while locked</button>`;
    } else if (isLockedByMe) {
        content += `<button class="btn btn-secondary btn-full" onclick="handleUnlock('${escapeHtml(projectName)}')">🔓 Release Lock</button>`;
        content += `<button class="btn btn-primary btn-full" onclick="handlePushProject('${escapeHtml(projectName)}')">↑ Push My Changes</button>`;
    } else {
        content += `<button class="btn btn-primary btn-full" onclick="handleImportProject('${escapeHtml(projectName)}')">↓ Import to My Folder</button>`;
        content += `<button class="btn btn-secondary btn-full" onclick="handleLockAndEdit('${escapeHtml(projectName)}')">🔒 Lock & Edit</button>`;
    }

    content += `</div>`;

    document.getElementById('project-modal-content').innerHTML = content;
    openModal('modal-project');
}

/* ============================================
   PROJECT ACTIONS
   ============================================ */

async function handlePushCurrent() {
    // Check if upload is already in progress
    if (isPushing) {
        const modal = document.getElementById('modal-upload-progress');
        const uploadIndicator = document.getElementById('upload-indicator');
        if (modal) {
            modal.classList.remove('hidden');
            if (uploadIndicator) uploadIndicator.classList.add('hidden');
        }
        return;
    }

    if (!currentProject) {
        alert('No project detected.\n\nUse "Add Project" to select a file manually.');
        return;
    }

    if (!GoogleDrive.isAuthenticated()) {
        alert('Please connect to Google Drive first.');
        return;
    }

    try {
        // Get all timeline dependencies (files actually used in the sequence)
        console.log('📦 Scanning timeline files...');
        console.log('Current project:', currentProject);

        // Get timeline files only (not all project panel files)
        console.log('🔍 Calling getTimelineFiles...');
        const timelineFilesArray = await FileSystem.getTimelineFiles();
        console.log('✅ Timeline files:', timelineFilesArray);
        console.log('✅ Timeline files count:', timelineFilesArray?.length || 0);

        // Build file list
        const allFiles = [];
        const seenPaths = new Set();

        // Add project file itself
        let projectSize = 0;
        try {
            const fs = require('fs');
            if (fs.existsSync(currentProject.path)) {
                projectSize = fs.statSync(currentProject.path).size;
            }
        } catch (e) {
            console.warn('Could not get project file size:', e);
        }

        allFiles.push({
            name: currentProject.name,
            path: currentProject.path,
            type: 'project',
            size: projectSize,
            selected: true
        });
        seenPaths.add(currentProject.path);

        // Add timeline files
        if (timelineFilesArray && Array.isArray(timelineFilesArray) && timelineFilesArray.length > 0) {
            console.log(`📥 Adding ${timelineFilesArray.length} timeline files`);
            const fs = require('fs');

            timelineFilesArray.forEach(file => {
                console.log('  - Timeline file:', file.name, file.path);
                if (file.path && !seenPaths.has(file.path)) {
                    // Get file size
                    let fileSize = 0;
                    try {
                        if (fs.existsSync(file.path)) {
                            fileSize = fs.statSync(file.path).size;
                        }
                    } catch (e) {
                        console.warn('Could not get file size for:', file.name);
                    }

                    allFiles.push({
                        name: file.name,
                        path: file.path,
                        type: file.type || 'file',
                        size: fileSize,
                        selected: true
                    });
                    seenPaths.add(file.path);
                }
            });
        } else {
            console.warn('⚠️ No timeline files detected');
            if (timelineFilesArray && timelineFilesArray.error) {
                console.error('Timeline error:', timelineFilesArray.error);
                alert('⚠️ Timeline scanning error: ' + timelineFilesArray.error + '\n\nMake sure you have an active sequence open.');
            }
        }

        // Optional: include all project-panel media in addition to timeline dependencies.
        if (Config.data.includeProjectMediaOnPush) {
            try {
                const projectMediaFiles = await FileSystem.getProjectMediaFiles();
                if (Array.isArray(projectMediaFiles) && projectMediaFiles.length > 0) {
                    console.log(`📦 Merging ${projectMediaFiles.length} project panel media files`);
                    const fs = require('fs');
                    for (const mediaFile of projectMediaFiles) {
                        if (!mediaFile.path || seenPaths.has(mediaFile.path)) continue;
                        let fileSize = 0;
                        try {
                            if (fs.existsSync(mediaFile.path)) {
                                fileSize = fs.statSync(mediaFile.path).size;
                            }
                        } catch (e) {
                            // Non-fatal if size lookup fails.
                        }
                        allFiles.push({
                            name: mediaFile.name || FileSystem.getBasename(mediaFile.path),
                            path: mediaFile.path,
                            type: mediaFile.type || 'file',
                            size: fileSize,
                            selected: true
                        });
                        seenPaths.add(mediaFile.path);
                    }
                }
            } catch (projectMediaError) {
                console.warn('Could not merge project media files:', projectMediaError);
            }
        } else {
            console.log('📌 Push scope: timeline dependencies only (project panel merge disabled)');
        }

        console.log('📋 Total files found:', allFiles.length);

        if (allFiles.length === 1) {
            console.warn('⚠️ Only .prproj file detected! No media files found in timeline.');
        }

        // =============================================
        // SCAN AFTER EFFECTS PROJECTS FOR FOOTAGE
        // Uses Node.js to read .aep binary and extract
        // embedded file paths (no AE or BridgeTalk needed)
        // =============================================
        const aepFiles = timelineFilesArray ? timelineFilesArray.filter(f => f.isAep) : [];

        if (aepFiles.length > 0) {
            console.log(`🎬 Found ${aepFiles.length} After Effects project(s) in timeline`);

            // Show scanning status
            const btn = elements.btnPush;
            const originalBtnText = btn.innerHTML;
            btn.innerHTML = '🎬 Scanning AE project files...';

            const fs = require('fs');
            const path = require('path');

            for (const aepFile of aepFiles) {
                console.log(`🎬 Binary scanning AE project: ${aepFile.path}`);

                try {
                    if (!fs.existsSync(aepFile.path)) {
                        console.warn('⚠️ AE project file not found:', aepFile.path);
                        continue;
                    }

                    // Preferred path: ask AE directly via BridgeTalk.
                    // This captures nested comps and linked media more reliably than binary parsing.
                    const compNames = (aepFile.compNames && aepFile.compNames.length > 0)
                        ? aepFile.compNames
                        : (aepFile.compName ? [aepFile.compName] : []);
                    const aeFootageFiles = await FileSystem.getAEFootageFiles(aepFile.path, compNames);
                    let bridgeTalkAdded = 0;

                    for (const footage of aeFootageFiles) {
                        if (!footage.path || seenPaths.has(footage.path)) continue;

                        let fileExists = false;
                        let fileSize = 0;
                        try {
                            if (fs.existsSync(footage.path)) {
                                fileExists = true;
                                fileSize = fs.statSync(footage.path).size;
                            }
                        } catch (e) {
                            console.warn('Could not check AE BridgeTalk file:', footage.path);
                        }
                        if (!fileExists) continue;

                        const ext = footage.path.split('.').pop().toLowerCase();
                        let type = 'file';
                        if (['mp4', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'mxf', 'mpg', 'mpeg', 'webm'].includes(ext)) type = 'video';
                        else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aif', 'aiff'].includes(ext)) type = 'audio';
                        else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'psd', 'ai', 'eps', 'tga', 'exr', 'webp', 'svg'].includes(ext)) type = 'image';

                        allFiles.push({
                            name: `[AE] ${footage.name || path.basename(footage.path)}`,
                            path: footage.path,
                            type: type,
                            size: fileSize,
                            selected: true,
                            isAeFootage: true
                        });
                        seenPaths.add(footage.path);
                        bridgeTalkAdded++;
                    }

                    if (bridgeTalkAdded > 0) {
                        console.log(`✅ AE BridgeTalk added ${bridgeTalkAdded} file(s) from ${aepFile.name}`);
                        continue; // Skip binary fallback when AE returns usable data
                    }

                    console.warn(`⚠️ AE BridgeTalk returned 0 files for ${aepFile.name}. Falling back to binary scan...`);

                    // Read the .aep binary file
                    const aepBuffer = fs.readFileSync(aepFile.path);

                    // Convert to string (latin1 preserves byte values)
                    const aepString = aepBuffer.toString('latin1');

                    // Extract file paths using regex patterns
                    // Look for Windows drive-letter paths (e.g., C:\, D:\, E:\, F:\)
                    // These appear as readable strings in the binary
                    const pathRegex = /([A-Z]:\\[^\x00-\x1F"*<>?|]{3,})/gi;
                    const foundPaths = new Set();
                    let match;

                    // Known media extensions to look for
                    const mediaExtensions = [
                        // Video
                        'mp4', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'mxf', 'mpg', 'mpeg', 'webm', 'flv',
                        // Audio
                        'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aif', 'aiff', 'wma',
                        // Image
                        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'psd', 'ai', 'eps',
                        'tga', 'exr', 'hdr', 'svg', 'webp', 'ico', 'raw', 'cr2', 'nef', 'dng',
                        // Image sequences
                        'dpx', 'cin',
                        // Other media
                        'swf', 'pdf'
                    ];

                    while ((match = pathRegex.exec(aepString)) !== null) {
                        let foundPath = match[1];

                        // Clean up the path - remove trailing non-path characters
                        foundPath = foundPath.replace(/[\x00-\x1F]+$/, '').trim();

                        // Remove any trailing junk (non-printable or control chars)
                        // Some paths end with garbage bytes
                        foundPath = foundPath.replace(/[^\x20-\x7E]+$/, '').trim();

                        // Check if path has a valid media extension
                        const ext = foundPath.split('.').pop().toLowerCase();
                        if (!mediaExtensions.includes(ext)) continue;

                        // Skip the .aep file itself
                        if (foundPath.toLowerCase() === aepFile.path.toLowerCase()) continue;

                        // Normalize path separators
                        foundPath = foundPath.replace(/\//g, '\\');

                        foundPaths.add(foundPath);
                    }

                    // Also try UTF-16LE encoded paths (AE sometimes stores paths this way)
                    // In UTF-16LE, ASCII chars have a null byte after each char
                    const utf16Regex = /([A-Z]\x00:\x00\\\x00[^\x00]{1}[\s\S]*?\.[\s\S]*?(?=\x00\x00\x00|\x00[^\x20-\x7E]))/gi;
                    let utf16Match;
                    while ((utf16Match = utf16Regex.exec(aepString)) !== null) {
                        // Convert UTF-16LE to regular string
                        let rawBytes = utf16Match[1];
                        let utf16Path = '';
                        for (let bi = 0; bi < rawBytes.length; bi += 2) {
                            const charCode = rawBytes.charCodeAt(bi);
                            if (charCode >= 0x20 && charCode <= 0x7E) {
                                utf16Path += String.fromCharCode(charCode);
                            } else if (charCode === 0x5C || charCode === 0x2F) {
                                utf16Path += '\\';
                            }
                        }

                        if (utf16Path.length > 5) {
                            const ext = utf16Path.split('.').pop().toLowerCase();
                            if (mediaExtensions.includes(ext)) {
                                utf16Path = utf16Path.replace(/\//g, '\\');
                                foundPaths.add(utf16Path);
                            }
                        }
                    }

                    console.log(`🔍 Found ${foundPaths.size} potential media path(s) in .aep binary`);

                    // Verify files exist and add to list
                    for (const foundPath of foundPaths) {
                        if (seenPaths.has(foundPath)) continue;

                        let fileExists = false;
                        let fileSize = 0;
                        try {
                            if (fs.existsSync(foundPath)) {
                                fileExists = true;
                                fileSize = fs.statSync(foundPath).size;
                            }
                        } catch (e) {
                            console.warn('Could not check AE file:', foundPath);
                        }

                        if (fileExists) {
                            const ext = foundPath.split('.').pop().toLowerCase();
                            let type = 'file';
                            if (['mp4', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'mxf', 'mpg', 'mpeg', 'webm'].includes(ext)) type = 'video';
                            else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'aif', 'aiff'].includes(ext)) type = 'audio';
                            else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'psd', 'ai', 'eps', 'tga', 'exr', 'webp', 'svg'].includes(ext)) type = 'image';

                            const fileName = path.basename(foundPath);
                            allFiles.push({
                                name: `[AE] ${fileName}`,
                                path: foundPath,
                                type: type,
                                size: fileSize,
                                selected: true,
                                isAeFootage: true
                            });
                            seenPaths.add(foundPath);
                            console.log(`  ✅ AE footage: ${fileName} (${foundPath})`);
                        } else {
                            console.log(`  ⚠️ AE file not found on disk: ${foundPath}`);
                        }
                    }
                } catch (aeError) {
                    console.error('❌ Error scanning AE project binary:', aeError);
                }
            }

            btn.innerHTML = originalBtnText;
            console.log('📋 Total files after AE scan:', allFiles.length);
        }

        // Show file selection modal
        showFileSelectionModal(currentProject.name, allFiles);

    } catch (error) {
        console.error('❌ Error scanning files:', error);
        console.error('Error stack:', error.stack);
        alert('Error scanning project files: ' + error.message);
    }
}

// File Selection Modal
function showFileSelectionModal(projectName, files) {
    pendingFilesToPush = files.map(f => ({ ...f, selected: true }));

    const listContainer = document.getElementById('file-selection-list');
    renderFileSelectionList(listContainer);
    updateFilesScopeLabel();
    updateFilesCount();

    openModal('modal-files');
}

function renderFileSelectionList(container) {
    container.innerHTML = pendingFilesToPush.map((file, index) => {
        const icon = getFileIcon(file.type);
        const sizeText = file.size ? formatBytes(file.size) : '0 B';
        return `
            <div class="file-selection-item ${file.selected ? 'selected' : ''}" data-index="${index}" onclick="toggleFileSelection(${index})">
                <input type="checkbox" ${file.selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleFileSelection(${index})">
                <div class="file-selection-icon">${icon}</div>
                <div class="file-selection-info">
                    <div class="file-selection-name">${escapeHtml(file.name)}</div>
                    <div class="file-selection-meta">${escapeHtml(file.type || 'file')} • ${sizeText}</div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleFileSelection(index) {
    pendingFilesToPush[index].selected = !pendingFilesToPush[index].selected;
    const container = document.getElementById('file-selection-list');
    renderFileSelectionList(container);
    updateFilesCount();
}

function toggleAllFileSelection(selectAll) {
    pendingFilesToPush.forEach(f => f.selected = selectAll);
    const container = document.getElementById('file-selection-list');
    renderFileSelectionList(container);
    updateFilesCount();
}

function updateFilesCount() {
    const count = pendingFilesToPush.filter(f => f.selected).length;
    document.getElementById('files-count').textContent = `${count} file(s) selected`;
}

function updateFilesScopeLabel() {
    const scopeLabel = document.getElementById('files-scope-label');
    if (!scopeLabel) return;
    scopeLabel.textContent = Config.data.includeProjectMediaOnPush
        ? 'Scope: All project media'
        : 'Scope: Timeline only';
}

function getFileIcon(type) {
    if (!type) return '📄';
    switch (type.toLowerCase()) {
        case 'video': return '🎥';
        case 'audio': return '🎵';
        case 'image': return '🖼️';
        case 'project': return '🎬';
        default: return '📄';
    }
}

function escapeReportText(text) {
    if (text === null || text === undefined) return '';
    return escapeHtml(String(text));
}

function showUploadReportModal(result) {
    const modal = document.getElementById('modal-upload-report');
    const summaryEl = document.getElementById('upload-report-summary');
    const listEl = document.getElementById('upload-report-list');
    if (!modal || !summaryEl || !listEl) return;

    const selected = result.totalCount || 0;
    const uploaded = result.uploadedCount || 0;
    const skipped = result.skippedCount || 0;
    const failed = result.failedCount || 0;
    const cancelled = result.cancelledCount || 0;
    const remaining = Math.max(0, selected - (uploaded + skipped + failed + cancelled));

    summaryEl.innerHTML = `
        <div class="upload-report-stat"><strong>${selected}</strong>Selected</div>
        <div class="upload-report-stat"><strong>${uploaded}</strong>Uploaded</div>
        <div class="upload-report-stat"><strong>${skipped}</strong>Skipped</div>
        <div class="upload-report-stat"><strong>${failed}</strong>Failed</div>
        <div class="upload-report-stat"><strong>${cancelled}</strong>Cancelled</div>
        <div class="upload-report-stat"><strong>${remaining}</strong>Remaining</div>
    `;

    const entries = Array.isArray(result.reportEntries) ? result.reportEntries : [];
    if (entries.length === 0) {
        listEl.innerHTML = `<div class="upload-report-row"><div class="upload-report-status uploaded">INFO</div><div class="upload-report-name">No per-file report entries available.</div><div class="upload-report-reason">Upload completed.</div></div>`;
    } else {
        listEl.innerHTML = entries.map(entry => {
            const status = (entry.status || 'uploaded').toLowerCase();
            const statusLabel = status.toUpperCase();
            const name = escapeReportText(entry.drivePath || entry.name || 'Unknown file');
            const reason = escapeReportText(entry.reason || '');
            return `
                <div class="upload-report-row">
                    <div class="upload-report-status ${status}">${statusLabel}</div>
                    <div class="upload-report-name">${name}</div>
                    <div class="upload-report-reason">${reason}</div>
                </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
}

async function handlePushSelectedFiles() {
    const selectedFiles = pendingFilesToPush.filter(f => f.selected);

    if (selectedFiles.length === 0) {
        alert('Please select at least one file to push.');
        return;
    }

    closeAllModals();

    // Show progress UI
    const btn = elements.btnPush;
    const originalText = btn.innerHTML;
    // Don't disable button so click works! 
    btn.classList.add('disabled-look'); // Add visual style instead if needed, or just rely on text
    btn.innerHTML = '⏳ Uploading...';

    isPushing = true; // Set flag

    try {
        console.log(`📤 Uploading ${selectedFiles.length} file(s)...`);

        // Prepare project data with selected files
        const projectData = {
            name: currentProject.name,
            path: currentProject.path,
            mediaFiles: selectedFiles.filter(f => f.type !== 'project') // Exclude .prproj from mediaFiles list
        };

        const result = await uploadProjectWithConcurrency(projectData, true);

        if (result.success) {
            console.log(`✅ Upload complete! ${result.uploadedCount} uploaded, ${result.skippedCount} skipped, ${result.failedCount} failed.`);
            btn.innerHTML = '✅ Complete!';
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }, 2000);
            showUploadReportModal(result);
            await refreshTeamProjects();
        } else {
            alert(`❌ Error: ${result.error}`);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    } catch (error) {
        console.error('Push error:', error);
        alert(`❌ Error: ${error.message}`);
    } finally {
        isPushing = false; // Reset flag
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.classList.remove('disabled-look');
        btn.style.cursor = '';
        pendingFilesToPush = [];
    }
}

/**
 * Handle pulling a project from Drive
 */
async function handlePullProjectOld(projectId, projectName) {
    console.log(`📥 Pull requested: ${projectName} (ID: ${projectId})`);

    // Check if sync folder is configured
    if (!Config.data.syncFolder) {
        alert('Please configure a sync folder first!\n\nGo to Settings and set your local sync folder.');
        return;
    }

    // Smart path detection: Check if this is the CURRENT project
    let targetFolder = Config.data.syncFolder;
    let projectPath = `${targetFolder}\\${projectName}`;
    let updateInPlace = false;

    if (currentProject && currentProject.name === `${projectName}.prproj`) {
        // User is pulling the SAME project they have open
        // Update in the current project's folder instead of creating subdirectory
        const currentDir = currentProject.path.substring(0, currentProject.path.lastIndexOf('\\'));
        console.log(`Current project directory: ${currentDir}`);
        console.log(`Sync folder: ${targetFolder}`);

        // Check if we're already in the sync folder (or a subdirectory of it)
        if (currentDir.toLowerCase().startsWith(targetFolder.toLowerCase())) {
            targetFolder = currentDir;
            projectPath = currentDir;
            updateInPlace = true;
            console.log(`✓ Updating current project in-place: ${projectPath}`);
        }
    }

    // Confirm pull
    const confirmMsg = updateInPlace
        ? `Update current project "${projectName}" from Drive?\n\nFiles will be synced in current location:\n${projectPath}`
        : `Pull "${projectName}" from Drive?\n\nFiles will be downloaded to:\n${projectPath}`;

    const confirm = window.confirm(confirmMsg);
    if (!confirm) return;

    try {
        // Call download helper with smart target folder
        const result = await downloadProjectWithProgress(
            projectName,
            projectId,
            updateInPlace ? targetFolder : Config.data.syncFolder,
            true, // Show progress modal
            updateInPlace // Pass flag to skip subdirectory creation
        );

        if (result.success) {
            let message = `✅ Download Complete!\n\n`;
            message += `Downloaded: ${result.downloadedCount} file(s)\n`;
            if (result.skippedCount > 0) {
                message += `Skipped: ${result.skippedCount} (unchanged)\n`;
            }

            // Handle conflicts - ask user what to do
            if (result.conflicts && result.conflicts.length > 0) {
                message += `\n⚠️ ${result.conflicts.length} file(s) have conflicts (different sizes):\n`;
                result.conflicts.forEach(c => {
                    message += `  - ${c.name}\n`;
                });
                message += `\nThese files were NOT downloaded yet.`;

                alert(message);

                // Ask if user wants to overwrite with Drive versions
                const overwrite = window.confirm(
                    `Do you want to UPDATE local files with Drive versions?\n\n` +
                    `⚠️ This will overwrite your local copies!\n\n` +
                    `Conflicted files:\n${result.conflicts.map(c => `  - ${c.name}`).join('\n')}\n\n` +
                    `OK = Use Drive version\nCancel = Keep local version`
                );

                if (overwrite) {
                    // Download conflicted files
                    let overwriteCount = 0;
                    for (const conflict of result.conflicts) {
                        try {
                            console.log(`Downloading conflict: ${conflict.name}`);
                            const fileContent = await GoogleDrive.downloadFile(conflict.driveFile.id);

                            // Convert to Base64
                            let binary = '';
                            const len = fileContent.byteLength;
                            for (let i = 0; i < len; i++) {
                                binary += String.fromCharCode(fileContent[i]);
                            }
                            const base64Content = btoa(binary);

                            // Write file
                            const writeResult = cep.fs.writeFile(conflict.localPath, base64Content, cep.encoding.Base64);
                            if (writeResult.err === 0) {
                                console.log(`✅ Overwritten: ${conflict.name}`);
                                overwriteCount++;
                            } else {
                                console.error(`❌ Failed to write: ${conflict.name}`);
                            }
                        } catch (error) {
                            console.error(`Error downloading ${conflict.name}:`, error);
                        }
                    }

                    alert(`✅ Updated ${overwriteCount} file(s) from Drive!`);
                } else {
                    alert(`Kept local versions of ${result.conflicts.length} file(s).`);
                }

                // Skip the rest, already handled
                return;
            }

            message += `\n\nLocation:\n${result.projectPath}`;

            alert(message);

            // Ask if user wants to open the project
            const openNow = window.confirm(`Open "${projectName}" in Premiere now?`);
            if (openNow) {
                const prprojPath = `${result.projectPath}\\${projectName}.prproj`;
                await FileSystem.openProject(prprojPath);
            }
        } else {
            alert(`❌ Download Failed!\n\n${result.error}`);
        }
    } catch (error) {
        console.error('Pull error:', error);
        alert(`❌ Error: ${error.message}`);
    }
}

async function handleAddProject() {
    try {
        const filePath = await FileSystem.selectFile('.prproj');

        if (filePath) {
            const projectName = FileSystem.getBasename(filePath);

            // Copy to sync folder if configured
            if (Config.data.syncFolder && FileSystem.fs) {
                const destPath = Config.data.syncFolder + '\\' + projectName;
                FileSystem.copyFile(filePath, destPath);
            }

            // Register on server
            const result = await SyncEngine.registerProject(projectName, filePath);

            if (result.success) {
                await SyncEngine.logActivity('push', projectName);
                alert(`✅ Added: ${projectName}`);
                await refreshTeamProjects();
            } else {
                alert(`❌ Error: ${result.error}`);
            }
        }
    } catch (error) {
        console.error('Error adding project:', error);
        alert('Could not add project. Try again.');
    }
}

async function handleImportProject(projectName) {
    if (!Config.data.syncFolder) {
        alert('Please set a sync folder first.\n\nClick "Browse..." or ✏️ to set the path.');
        closeAllModals();
        return;
    }

    // Find the project in our list
    const project = teamProjects.find(p => p.name === projectName);
    if (!project || !project.path) {
        alert('Could not find project source path.\n\nThe project might not have been pushed with a valid path.');
        closeAllModals();
        return;
    }

    const sourcePath = project.path;
    // Get the project folder (parent directory of .prproj)
    const sourceFolder = FileSystem.getDirname(sourcePath);
    const projectFolderName = FileSystem.getBasename(sourceFolder);
    const destFolder = Config.data.syncFolder + '\\' + projectFolderName;

    // Also get all the files associated with this project from the server
    let projectFiles = [];
    try {
        const filesResponse = await fetch(`${Config.data.serverUrl}/api/projects/${encodeURIComponent(projectName)}/files`);
        projectFiles = await filesResponse.json();
    } catch (e) {
        console.log('Could not fetch project files:', e);
    }

    // Build list of files to copy
    const filesToCopy = [];

    // Always include the .prproj file
    filesToCopy.push({
        source: sourcePath,
        name: FileSystem.getBasename(sourcePath)
    });

    // Add all timeline/project files
    for (const file of projectFiles) {
        if (file.file_path) {
            filesToCopy.push({
                source: file.file_path,
                name: file.file_name || FileSystem.getBasename(file.file_path)
            });
        }
    }

    // Confirm import
    const shouldImport = confirm(
        `Import "${projectName}" to your sync folder?\n\n` +
        `Project file + ${filesToCopy.length - 1} timeline file(s)\n\n` +
        `From: ${sourceFolder}\n` +
        `To: ${destFolder}\n\n` +
        `This will copy the entire project folder.`
    );

    if (!shouldImport) {
        closeAllModals();
        return;
    }

    try {
        let copiedCount = 0;
        let failedFiles = [];

        // Create destination folder if needed
        if (FileSystem.fs) {
            if (!FileSystem.fs.existsSync(destFolder)) {
                FileSystem.fs.mkdirSync(destFolder, { recursive: true });
            }
        } else if (typeof cep !== 'undefined' && cep.fs) {
            // CEP doesn't have mkdir, so we try to create it via other means
            // For now, we'll just copy files to sync folder directly
        }

        // Copy each file
        for (const file of filesToCopy) {
            try {
                const destPath = destFolder + '\\' + file.name;

                if (FileSystem.fs) {
                    if (FileSystem.fs.existsSync(file.source)) {
                        FileSystem.fs.copyFileSync(file.source, destPath);
                        copiedCount++;
                    } else {
                        failedFiles.push(file.name + ' (not found)');
                    }
                } else if (typeof cep !== 'undefined' && cep.fs) {
                    const readResult = cep.fs.readFile(file.source);
                    if (readResult.err === 0) {
                        cep.fs.writeFile(destPath, readResult.data);
                        copiedCount++;
                    } else {
                        failedFiles.push(file.name + ' (read error)');
                    }
                }
            } catch (e) {
                failedFiles.push(file.name + ' (error)');
            }
        }

        await SyncEngine.logActivity('pull', projectName);
        closeAllModals();

        let message = `✅ Imported: ${projectName}\n\n`;
        message += `Copied ${copiedCount} file(s) to:\n${destFolder}\n\n`;

        if (failedFiles.length > 0) {
            message += `⚠️ Some files couldn't be copied:\n${failedFiles.join('\n')}`;
        } else {
            message += `You can now open it in Premiere.`;
        }

        alert(message);

    } catch (error) {
        console.error('Import error:', error);
        alert(`Error importing project:\n${error.message}`);
        closeAllModals();
    }
}

async function handleLockAndEdit(projectName) {
    const result = await SyncEngine.lockProject(projectName);

    if (result.success) {
        await SyncEngine.logActivity('lock', projectName);
        closeAllModals();

        projectLocks[projectName] = {
            project_name: projectName,
            locked_by: Config.data.editorName,
            locked_at: new Date().toISOString()
        };

        renderTeamProjects();
        alert(`✅ Project locked!\n\nYou can now safely edit ${projectName}.\nOthers won't be able to edit until you release.`);
    } else {
        alert(`❌ ${result.error}`);
    }
}

async function handleUnlock(projectName) {
    const result = await SyncEngine.unlockProject(projectName);

    if (result.success) {
        await SyncEngine.logActivity('unlock', projectName);
        closeAllModals();

        delete projectLocks[projectName];
        renderTeamProjects();

        alert(`✅ Lock released for ${projectName}`);
    } else {
        alert(`❌ ${result.error}`);
    }
}

async function handlePushProject(projectName) {
    await SyncEngine.logActivity('push', projectName);
    closeAllModals();
    alert(`✅ Changes pushed: ${projectName}`);
    await refreshTeamProjects();
}

/* ============================================
   UI HELPERS
   ============================================ */

function updateConnectionStatus(connected) {
    if (connected) {
        elements.syncStatus.classList.add('connected');
        elements.syncStatus.classList.remove('error');
        elements.statusText.textContent = 'Connected';
    } else {
        elements.syncStatus.classList.remove('connected');
        elements.syncStatus.classList.add('error');
        elements.statusText.textContent = 'Disconnected';
    }
}

function updateLastCheckTime() {
    const now = new Date();
    elements.lastCheck.textContent = `Last check: ${now.toLocaleTimeString()}`;
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
    });
}

function formatDate(dateInput) {
    if (!dateInput) return 'N/A';
    const date = new Date(dateInput);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose functions for inline onclick handlers
window.handleLockAndEdit = handleLockAndEdit;
window.handleUnlock = handleUnlock;
window.handlePushProject = handlePushProject;
window.handleImportProject = handleImportProject;

/**
 * Render the Project Explorer File List
 */
function renderProjectExplorer(driveFiles, offlineFiles, targetFolder, isCurrentProject) {
    const list = document.getElementById('explorer-file-list');
    list.innerHTML = '';

    // Node.js fs for checking local files
    let fs = null;
    try { if (typeof require !== 'undefined') fs = require('fs'); } catch (e) { }

    driveFiles.forEach(file => {
        const row = document.createElement('div');
        row.className = 'explorer-row';

        // Check Local Status
        const localPath = `${targetFolder}\\${file.name}`;
        let localSize = -1;
        let exists = false;

        if (fs && fs.existsSync(localPath)) {
            exists = true;
            localSize = fs.statSync(localPath).size;
        }

        // Determine Status
        let statusHtml = '';
        let actionBtn = '';
        const driveSize = parseInt(file.size) || 0;

        // Check if this file is Offline in Premiere
        // Match by name, or by fileName from original path, or by filename at end of Drive name
        const driveBaseName = file.name.includes('/') ? file.name.split('/').pop() : file.name;
        const offlineItem = offlineFiles.find(of =>
            of.name === file.name ||
            of.name === driveBaseName ||
            (of.fileName && of.fileName === file.name) ||
            (of.fileName && of.fileName === driveBaseName) ||
            (of.lastPath && of.lastPath.endsWith(driveBaseName))
        );

        if (offlineItem) {
            statusHtml = '<span class="status-offline">⚠️ Offline in Timeline</span>';
            // Escaping backslashes for JS string in HTML attribute
            const safePath = targetFolder.replace(/\\/g, '\\\\');
            actionBtn = `<button class="btn btn-primary btn-small" onclick="handleSingleFilePull('${file.id}', '${file.name}', '${safePath}', '${offlineItem.nodeId}')">Pull & Link</button>`;
        } else if (!exists) {
            statusHtml = '<span class="status-missing">Missing Locally</span>';
            const safePath = targetFolder.replace(/\\/g, '\\\\');
            actionBtn = `<button class="btn btn-primary btn-small" onclick="handleSingleFilePull('${file.id}', '${file.name}', '${safePath}', null)">Pull</button>`;
        } else if (localSize !== driveSize) {
            statusHtml = `<span class="status-changed">Modified (${formatBytes(localSize)} vs ${formatBytes(driveSize)})</span>`;
            const safePath = targetFolder.replace(/\\/g, '\\\\');
            actionBtn = `<button class="btn btn-secondary btn-small" onclick="handleSingleFilePull('${file.id}', '${file.name}', '${safePath}', null)">Update</button>`;
        } else {
            statusHtml = '<span class="status-synced">✓ Synced</span>';
            const safePath = targetFolder.replace(/\\/g, '\\\\');
            actionBtn = `<button class="btn btn-icon btn-small" title="Force Download" onclick="handleSingleFilePull('${file.id}', '${file.name}', '${safePath}', null)">⬇️</button>`;
        }

        // Special handling for .prproj
        if (file.name.endsWith('.prproj')) {
            if (isCurrentProject && localSize !== driveSize) {
                statusHtml = '<span class="status-changed">⚠️ Project Update!</span>';
                const safePath = targetFolder.replace(/\\/g, '\\\\');
                actionBtn = `<button class="btn btn-danger btn-small" onclick="handleSingleFilePull('${file.id}', '${file.name}', '${safePath}', 'PROJECT_RELOAD')">Update & Reload</button>`;
            }
        }

        // Icon
        let icon = '📄';
        if (file.mimeType && file.mimeType.includes('video')) icon = '🎬';
        if (file.mimeType && file.mimeType.includes('image')) icon = '🖼️';
        if (file.mimeType && file.mimeType.includes('audio')) icon = '🎵';
        if (file.name.endsWith('.prproj')) icon = '🟣';

        row.innerHTML = `
            <div class="col-name" title="${file.name}">
                <span class="file-icon">${icon}</span> ${file.name}
            </div>
            <div class="col-size">${formatBytes(driveSize)}</div>
            <div class="col-status">${statusHtml}</div>
            <div class="col-action">${actionBtn}</div>
        `;

        list.appendChild(row);
    });
}

// Store explorer context for Pull All
let explorerContext = { files: [], targetFolder: '', offlineFiles: [] };
let pullCancelled = false;

/**
 * Cancel the Pull All operation
 */
function cancelPullAll() {
    pullCancelled = true;
    const statusEl = document.getElementById('explorer-status');
    if (statusEl) statusEl.textContent = 'Cancelling...';
    console.log('🛑 Pull All cancelled by user');
}
window.cancelPullAll = cancelPullAll;

/**
 * Pull All files from the current project explorer
 */
async function handlePullAll() {
    const { files, targetFolder, offlineFiles } = explorerContext;
    if (!files || files.length === 0) {
        alert('No files to pull.');
        return;
    }

    // Reset cancellation flag
    pullCancelled = false;

    const btn = document.getElementById('btn-pull-all');
    const cancelBtn = document.getElementById('btn-cancel-pull');

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Pulling...';
    }
    if (cancelBtn) {
        cancelBtn.classList.remove('hidden');
    }

    isPulling = true;
    const downloadIndicator = document.getElementById('download-indicator');

    const statusEl = document.getElementById('explorer-status');
    let pulled = 0;
    let skipped = 0;
    let cancelled = 0;
    const total = files.length;

    // Node.js fs for checking local files
    let fs = null;
    try { if (typeof require !== 'undefined') fs = require('fs'); } catch (e) { }

    // Sort files so .prproj is LAST — ensures all media is downloaded before project patching
    files.sort((a, b) => {
        const aIsPrproj = a.name.endsWith('.prproj') ? 1 : 0;
        const bIsPrproj = b.name.endsWith('.prproj') ? 1 : 0;
        return aIsPrproj - bIsPrproj;
    });

    for (const file of files) {
        // Check for cancellation
        if (pullCancelled) {
            cancelled = total - pulled - skipped;
            console.log(`🛑 Pull cancelled. ${pulled} pulled, ${skipped} skipped, ${cancelled} cancelled.`);
            break;
        }

        const processedBefore = pulled + skipped;
        const remainingBefore = Math.max(0, total - processedBefore);
        if (statusEl) statusEl.textContent = `Pulling ${processedBefore + 1}/${total}: ${file.name} (remaining: ${remainingBefore})`;

        // Check if already synced locally
        const localPath = `${targetFolder}\\${file.name}`;
        let exists = false;
        let localSize = -1;
        if (fs && fs.existsSync(localPath)) {
            exists = true;
            localSize = fs.statSync(localPath).size;
        }
        const driveSize = parseInt(file.size) || 0;

        if (exists && localSize === driveSize) {
            skipped++;
            const processedNow = pulled + skipped;
            const remainingNow = Math.max(0, total - processedNow);
            if (statusEl) statusEl.textContent = `Skipped ${file.name} (${processedNow}/${total}, remaining: ${remainingNow})`;
            continue; // Already synced, skip
        }

        // Find if this file is offline in timeline
        const pullBaseName = file.name.includes('/') ? file.name.split('/').pop() : file.name;
        const offlineItem = offlineFiles.find(of =>
            of.name === file.name ||
            of.name === pullBaseName ||
            (of.fileName && of.fileName === file.name) ||
            (of.fileName && of.fileName === pullBaseName) ||
            (of.lastPath && of.lastPath.endsWith(pullBaseName))
        );
        const linkNodeId = offlineItem ? offlineItem.nodeId : null;

        try {
            const safePath = targetFolder.replace(/\\/g, '\\\\');
            await handleSingleFilePull(file.id, file.name, safePath, linkNodeId);
            pulled++;
            const processedNow = pulled + skipped;
            const remainingNow = Math.max(0, total - processedNow);
            if (statusEl) statusEl.textContent = `Pulled ${file.name} (${processedNow}/${total}, remaining: ${remainingNow})`;
        } catch (e) {
            console.error(`Failed to pull ${file.name}:`, e);
            const processedNow = pulled + skipped;
            const remainingNow = Math.max(0, total - processedNow);
            if (statusEl) statusEl.textContent = `Error pulling ${file.name} (${processedNow}/${total}, remaining: ${remainingNow})`;
        }
    }

    // Handle cancellation
    if (pullCancelled) {
        if (statusEl) statusEl.textContent = `🛑 Cancelled! Pulled ${pulled}, skipped ${skipped}, cancelled ${cancelled} files.`;
    } else {
        // Auto-relink all offline media after pulling
        if (pulled > 0) {
            if (statusEl) statusEl.textContent = `🔗 Auto-relinking offline media...`;
            console.log('🔗 Running auto-relink for target folder:', targetFolder);

            try {
                const relinkResult = await new Promise(resolve => {
                    const escapedPath = targetFolder.replace(/\\/g, '\\\\');
                    FileSystem.csInterface.evalScript(`autoRelinkOfflineMedia('${escapedPath}')`, resolve);
                });

                console.log('Auto-relink result:', relinkResult);
                const r = JSON.parse(relinkResult);

                if (r.relinked > 0) {
                    if (statusEl) statusEl.textContent = `Done! Pulled ${pulled} files, relinked ${r.relinked} media. ${skipped} already synced.`;
                    console.log(`✅ Auto-relinked ${r.relinked} offline media items`);
                } else {
                    if (statusEl) statusEl.textContent = `Done! Pulled ${pulled} files, ${skipped} already synced.`;
                }
            } catch (relinkErr) {
                console.error('Auto-relink error:', relinkErr);
                if (statusEl) statusEl.textContent = `Done! Pulled ${pulled} files, ${skipped} already synced. (Relink failed)`;
            }
        } else {
            if (statusEl) statusEl.textContent = `Done! ${skipped} files already synced.`;
        }
    }

    isPulling = false;
    pullCancelled = false; // Reset flag
    const dlIndicator = document.getElementById('download-indicator');
    if (dlIndicator) dlIndicator.classList.add('hidden');

    if (btn) {
        btn.disabled = false;
        btn.textContent = '⬇️ Pull All';
    }
    if (cancelBtn) {
        cancelBtn.classList.add('hidden');
    }
}

window.handlePullAll = handlePullAll;

/**
 * Reopen the explorer modal from the floating download indicator
 */
function reopenExplorerModal() {
    const modal = document.getElementById('modal-project-explorer');
    const downloadIndicator = document.getElementById('download-indicator');
    if (modal) modal.classList.remove('hidden');
    if (downloadIndicator) downloadIndicator.classList.add('hidden');
}
window.reopenExplorerModal = reopenExplorerModal;
/**
 * Handle Single File Pull & Auto-Link
 */
const downloadingFiles = new Set(); // Track files currently being downloaded

async function handleSingleFilePull(fileId, fileName, targetFolder, linkNodeId) {
    console.log(`⬇️ Pulling single file: ${fileName}`);

    // Prevent duplicate downloads
    if (downloadingFiles.has(fileId)) {
        console.log(`Already downloading ${fileName}, skipping...`);
        return;
    }

    downloadingFiles.add(fileId);

    // Store current project info for auto-refresh
    const titleSpan = document.getElementById('explorer-project-name');
    const currentProjectName = titleSpan ? titleSpan.textContent : '';
    const currentProject = teamProjects.find(p => p.name === currentProjectName);

    // UI Elements
    const statusEl = document.getElementById('explorer-status');
    const progressContainer = document.getElementById('explorer-progress');
    const progressFileName = document.getElementById('progress-file-name');
    const progressSpeed = document.getElementById('progress-speed');
    const progressBar = document.getElementById('progress-bar-fill');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressSize = document.getElementById('progress-size');

    try {
        // Show progress bar
        if (progressContainer) progressContainer.classList.remove('hidden');
        if (progressFileName) progressFileName.textContent = fileName;
        if (statusEl) statusEl.textContent = `Downloading ${fileName}...`;

        // Download with progress tracking
        const accessToken = await GoogleDrive.getValidToken();
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

        // Track download speed
        let startTime = Date.now();
        let lastTime = startTime;
        let lastLoaded = 0;

        const content = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', downloadUrl, true);
            xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            xhr.responseType = 'arraybuffer';

            xhr.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentage = (event.loaded / event.total) * 100;
                    const loadedMB = (event.loaded / (1024 * 1024)).toFixed(2);
                    const totalMB = (event.total / (1024 * 1024)).toFixed(2);

                    // Calculate speed
                    const now = Date.now();
                    const timeDiff = now - lastTime;
                    if (timeDiff > 500) { // Update speed every 500ms
                        const bytesDiff = event.loaded - lastLoaded;
                        const speed = (bytesDiff / timeDiff) * 1000; // bytes per second
                        const speedKB = (speed / 1024).toFixed(1);
                        if (progressSpeed) progressSpeed.textContent = `${speedKB} KB/s`;
                        lastTime = now;
                        lastLoaded = event.loaded;
                    }

                    // Update UI
                    if (progressBar) progressBar.style.width = `${percentage}%`;
                    if (progressPercentage) progressPercentage.textContent = `${percentage.toFixed(0)}%`;
                    if (progressSize) progressSize.textContent = `${loadedMB} / ${totalMB} MB`;
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(new Uint8Array(xhr.response));
                } else {
                    reject(new Error(`Download failed: ${xhr.statusText}`));
                }
            };

            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
        });

        // Hide progress bar
        if (progressContainer) progressContainer.classList.add('hidden');
        if (statusEl) statusEl.textContent = `Writing file...`;

        // 2. Write to disk
        const fs = require('fs');
        const path = require('path');

        const targetPath = `${targetFolder}\\${fileName.replace(/\//g, '\\')}`;

        // Ensure ALL parent folders exist (handles subfolder files like "subfolder/file.aep")
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
            console.log(`📁 Created directory: ${parentDir}`);
        }

        // Write using Node.js fs directly (more reliable than cep.fs for binary)
        const nodeBuffer = Buffer.from(content);
        fs.writeFileSync(targetPath, nodeBuffer);

        console.log(`✅ Saved to: ${targetPath}`);

        // 2.5 PATCH .prproj file: Replace media paths to point to download folder
        if (fileName.endsWith('.prproj')) {
            try {
                console.log('🔧 Patching .prproj media paths...');
                if (statusEl) statusEl.textContent = `Patching project paths...`;

                const zlib = require('zlib');

                // Read and decompress the .prproj (gzip-compressed XML)
                const prprojBuffer = fs.readFileSync(targetPath);
                const xmlBuffer = zlib.gunzipSync(prprojBuffer);
                let xmlString = xmlBuffer.toString('utf8');

                // Build a map of available files in the target folder (recursive)
                const availableFiles = {};
                function scanFolder(dir) {
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const fullPath = path.join(dir, entry.name);
                            if (entry.isFile()) {
                                // Map by lowercase filename for matching
                                availableFiles[entry.name.toLowerCase()] = fullPath;
                            } else if (entry.isDirectory()) {
                                scanFolder(fullPath); // Recurse into subfolders
                            }
                        }
                    } catch (e) {
                        console.warn('Could not scan folder:', dir, e.message);
                    }
                }
                scanFolder(targetFolder);

                console.log('📁 Available files in target folder:', Object.keys(availableFiles));

                // Find and replace file paths in the XML
                // Premiere stores paths in XML like: <ActualMediaFilePath>C:\original\path\file.ext</ActualMediaFilePath>
                // Also in attributes and other elements
                let patchCount = 0;

                // Pattern: match Windows absolute paths (drive letter paths)
                // This regex finds paths like C:\folder\subfolder\file.ext
                const pathPattern = /([A-Z]:\\(?:[^<>"*?|\r\n]+\\)*([^<>"*?|\\\r\n]+\.[a-zA-Z0-9]{2,6}))/gi;

                xmlString = xmlString.replace(pathPattern, (fullMatch, fullPath, basename) => {
                    const lowerBasename = basename.toLowerCase();

                    // Check if we have this file in our download folder
                    if (availableFiles[lowerBasename]) {
                        const newPath = availableFiles[lowerBasename];
                        if (newPath.toLowerCase() !== fullPath.toLowerCase()) {
                            patchCount++;
                            console.log(`  🔗 ${basename}: ${fullPath} → ${newPath}`);
                            return newPath;
                        }
                    }

                    return fullMatch; // No change
                });

                console.log(`✅ Patched ${patchCount} media path(s) in .prproj`);

                // Recompress and save
                if (patchCount > 0) {
                    const patchedXml = Buffer.from(xmlString, 'utf8');
                    const recompressed = zlib.gzipSync(patchedXml);
                    fs.writeFileSync(targetPath, recompressed);
                    console.log('✅ Saved patched .prproj');
                }

            } catch (patchError) {
                console.error('⚠️ Could not patch .prproj paths (non-fatal):', patchError.message);
                // Non-fatal — project will still open, just with Link Media dialog
            }
        }

        // 3. Auto-Actions
        if (linkNodeId === 'PROJECT_RELOAD') {
            // It's the project file!
            if (confirm('Project updated! Reload project now?')) {
                await FileSystem.openProject(targetPath);

                // Auto-relink offline media after project reload (with delay for load)
                setTimeout(() => {
                    const escapedFolder = targetFolder.replace(/\\/g, '\\\\');
                    console.log('🔗 Auto-relinking media after project reload...');
                    FileSystem.csInterface.evalScript(`autoRelinkOfflineMedia('${escapedFolder}')`, (res) => {
                        try {
                            const r = JSON.parse(res);
                            if (r.relinked > 0) {
                                console.log(`✅ Auto-relinked ${r.relinked} media items after reload`);
                            }
                        } catch (e) {
                            console.warn('Auto-relink parse error:', e);
                        }
                    });
                }, 3000); // Wait 3s for project to fully load
            }
        } else if (linkNodeId && linkNodeId !== 'null') {
            // It's a media file to link!
            console.log(`🔗 Auto-linking node ${linkNodeId} to ${targetPath}`);
            if (statusEl) statusEl.textContent = `Linking media...`;

            FileSystem.csInterface.evalScript(`relinkMedia('${linkNodeId}', '${targetPath.replace(/\\/g, '\\\\')}')`, (res) => {
                const r = JSON.parse(res);
                if (r.success) {
                    alert(`✅ Linked ${fileName}!`);
                    if (statusEl) statusEl.textContent = `Linked ${fileName}`;
                } else {
                    alert(`Downloaded but failed to link: ${r.error}`);
                }
            });
        }

        if (statusEl) statusEl.textContent = `Downloaded ${fileName}`;

        // 4. Auto-refresh the file list (skip loading spinner)
        setTimeout(() => {
            if (currentProject) {
                console.log('Auto-refreshing file list...');
                handlePullProject(currentProject.id, currentProjectName, true);
            }
        }, 1000);

    } catch (e) {
        console.error(e);
        alert(`Download failed: ${e.message}`);
        const statusEl = document.getElementById('explorer-status');
        if (statusEl) statusEl.textContent = `Error downloading ${fileName}`;
        if (progressContainer) progressContainer.classList.add('hidden');
    } finally {
        // Remove from downloading set
        downloadingFiles.delete(fileId);
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Ensure single file pull is available globally

/**
 * Handle viewing a project (Smart Pull)
 * Opens the Project Explorer instead of auto-downloading
 */
async function handlePullProject(projectId, projectName, skipLoading = false) {
    console.log(`📂 Opening Project Explorer for: ${projectName}`);

    if (!Config.data.syncFolder) {
        alert('Please configure a sync folder first!');
        return;
    }

    // Show loading state in explorer
    const modal = document.getElementById('modal-project-explorer');
    const title = document.getElementById('explorer-project-name');
    const list = document.getElementById('explorer-file-list');
    const status = document.getElementById('explorer-status');

    if (modal) {
        modal.classList.remove('hidden');
        title.textContent = projectName;

        // Only show loading spinner on initial load, not refreshes
        if (!skipLoading) {
            list.innerHTML = `
                <div class="explorer-loading">
                    <div class="loading-spinner"></div>
                    <p>Connecting to Google Drive...</p>
                </div>
            `;
            if (status) status.textContent = 'Loading files from Drive...';
        } else {
            if (status) status.textContent = 'Refreshing...';
        }
    }

    try {
        // 1. Fetch Drive Files
        const driveFiles = await GoogleDrive.listFilesInFolder(projectId);
        console.log(`Found ${driveFiles.length} files on Drive`);

        // 2. Fetch Offline Files from Premiere
        if (status) status.textContent = 'Checking local project status...';
        const offlineResultStr = await new Promise(resolve => {
            FileSystem.csInterface.evalScript('getOfflineFiles()', resolve);
        });
        console.log('getOfflineFiles() raw result:', offlineResultStr);
        const offlineResult = JSON.parse(offlineResultStr);
        const offlineFiles = offlineResult.files || [];
        console.log('Offline files detected:', offlineFiles.length, offlineFiles);

        // 3. Check Local Files (Sync Folder)
        // Determine target folder (Smart detection)
        let targetFolder = Config.data.syncFolder;
        let isCurrentProject = false;

        if (currentProject && currentProject.name === `${projectName}.prproj`) {
            const currentDir = currentProject.path.substring(0, currentProject.path.lastIndexOf('\\'));
            targetFolder = currentDir;
            isCurrentProject = true;
        } else {
            targetFolder = `${Config.data.syncFolder}\\${projectName}`;
        }

        if (status) status.textContent = `Found ${driveFiles.length} files. Rendering...`;

        // Store context for Pull All button
        explorerContext = { files: driveFiles, targetFolder, offlineFiles };

        // 4. Render File List
        renderProjectExplorer(driveFiles, offlineFiles, targetFolder, isCurrentProject);
        if (status) status.textContent = `Ready`;

    } catch (error) {
        console.error('Explorer error:', error);
        if (status) status.textContent = `Error: ${error.message}`;
        alert(`Failed to load project files: ${error.message}`);
    }
}


