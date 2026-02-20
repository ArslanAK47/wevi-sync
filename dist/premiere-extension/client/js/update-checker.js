/**
 * Auto-Update Checker for Team Sync Extension
 *
 * Features:
 * - Checks GitHub (or local test server) for newer versions on startup
 * - Shows popup modal when update available
 * - Supports local testing mode for development
 * - One-click update with progress tracking
 * - Force check for updates button in settings
 *
 * Flow:
 * 1. On startup, read local version.json
 * 2. Fetch remote version.json from configured source
 * 3. Compare versions. If remote > local, show update modal
 * 4. On "Update Now", download all files and overwrite
 */

const UPDATE_CONFIG = {
    // Default: GitHub remote URLs
    remote: {
        versionUrl: 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/version.json',
        repoBaseUrl: 'https://api.github.com/repos/ArslanAK47/wevi-sync/contents/dist/premiere-extension',
        rawBaseUrl: 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/dist/premiere-extension'
    },
    // Local testing server (for development)
    local: {
        versionUrl: 'http://localhost:8888/version.json',
        repoBaseUrl: 'http://localhost:8888/files.json', // Returns file list in same format
        rawBaseUrl: 'http://localhost:8888/files'
    },
    // Active mode: 'remote' or 'local'
    mode: 'remote',
    // Check interval (milliseconds) - 0 = only on startup
    checkInterval: 0,
    // Startup delay before first check
    startupDelay: 3000,
    // Show update notifications
    enabled: true
};

// State
let updateCheckInProgress = false;
let lastUpdateCheck = null;
let availableUpdate = null;

/**
 * Get active update URLs based on current mode
 */
function getUpdateUrls() {
    return UPDATE_CONFIG.mode === 'local' ? UPDATE_CONFIG.local : UPDATE_CONFIG.remote;
}

/**
 * HTTP GET using XMLHttpRequest (most reliable in CEP panels)
 * Works in CEP's embedded Chromium when Node.js https and fetch fail.
 */
function xhrGet(url) {
    return new Promise((resolve, reject) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 10000;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error('XHR HTTP ' + xhr.status));
                }
            };
            xhr.onerror = function () {
                reject(new Error('XHR network error'));
            };
            xhr.ontimeout = function () {
                reject(new Error('XHR timeout (10s)'));
            };
            xhr.send();
        } catch (e) {
            reject(new Error('XHR exception: ' + e.message));
        }
    });
}

/**
 * HTTP GET using Node.js (bypasses browser CORS restrictions)
 */
function nodeHttpGet(url) {
    return new Promise((resolve, reject) => {
        try {
            const protocol = url.startsWith('https') ? require('https') : require('http');
            const req = protocol.get(url, { headers: { 'User-Agent': 'TeamSync-Extension' }, timeout: 10000 }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    nodeHttpGet(response.headers.location).then(resolve).catch(reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject(new Error('Node HTTP ' + response.statusCode));
                    return;
                }
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => resolve(data));
                response.on('error', reject);
            });
            req.on('error', (err) => reject(new Error('Node error: ' + err.message)));
            req.on('timeout', () => { req.destroy(); reject(new Error('Node timeout (10s)')); });
        } catch (e) {
            reject(new Error('Node require failed: ' + e.message));
        }
    });
}

/**
 * HTTP GET using browser fetch
 */
function browserFetchGet(url) {
    return fetch(url).then(r => {
        if (!r.ok) throw new Error('Fetch HTTP ' + r.status);
        return r.text();
    });
}

/**
 * Fetch remote text - tries XHR first, then Node.js https, then browser fetch
 */
async function fetchRemoteText(url) {
    const errors = [];

    // Method 1: XMLHttpRequest (most reliable in CEP)
    try {
        console.log('[Update] Trying XMLHttpRequest for:', url);
        const result = await xhrGet(url);
        console.log('[Update] XMLHttpRequest succeeded');
        return result;
    } catch (e) {
        console.warn('[Update] XMLHttpRequest failed:', e.message);
        errors.push('XHR: ' + e.message);
    }

    // Method 2: Node.js https
    try {
        console.log('[Update] Trying Node.js https...');
        const result = await nodeHttpGet(url);
        console.log('[Update] Node.js https succeeded');
        return result;
    } catch (e) {
        console.warn('[Update] Node.js https failed:', e.message);
        errors.push('Node: ' + e.message);
    }

    // Method 3: browser fetch
    try {
        console.log('[Update] Trying browser fetch...');
        const result = await browserFetchGet(url);
        console.log('[Update] Browser fetch succeeded');
        return result;
    } catch (e) {
        console.warn('[Update] Browser fetch failed:', e.message);
        errors.push('Fetch: ' + e.message);
    }

    throw new Error('All methods failed: ' + errors.join(' | '));
}

/**
 * Show notification to user (info or error)
 */
function showNotification(message, type) {
    const isError = type === 'error';
    const notification = document.createElement('div');
    notification.innerHTML = `<span>${message}</span>`;
    notification.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${isError ? '#4a2d2d' : '#2d3a4a'}; color: ${isError ? '#ff6b6b' : '#6bb5ff'};
        padding: 12px 20px; border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000; max-width: 400px; font-size: 12px;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 6000);
}

function showErrorNotification(message) { showNotification(message, 'error'); }

/**
 * Switch between local and remote update sources (for testing)
 */
function setUpdateMode(mode) {
    if (mode === 'local' || mode === 'remote') {
        UPDATE_CONFIG.mode = mode;
        console.log(`🔧 Update mode set to: ${mode}`);
        // Save preference
        try {
            localStorage.setItem('update_mode', mode);
        } catch (e) { }
        return true;
    }
    return false;
}
window.setUpdateMode = setUpdateMode;

/**
 * Get current update mode
 */
function getUpdateMode() {
    return UPDATE_CONFIG.mode;
}
window.getUpdateMode = getUpdateMode;

/**
 * Load update mode from storage
 */
function loadUpdateMode() {
    // Always default to remote for production. Clear any stale 'local' setting.
    try {
        const saved = localStorage.getItem('update_mode');
        if (saved === 'local') {
            // Local mode should only be active if test server is running
            console.log('[Update] Found saved mode: local - resetting to remote for production');
            localStorage.removeItem('update_mode');
            UPDATE_CONFIG.mode = 'remote';
        } else if (saved === 'remote') {
            UPDATE_CONFIG.mode = 'remote';
        }
    } catch (e) { }
    console.log('[Update] Active mode:', UPDATE_CONFIG.mode);
}

/**
 * Compare two semver version strings
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

/**
 * Get the extension root directory reliably.
 * Uses window.location (the HTML file URL) since __dirname is unreliable in CEP mixed-context.
 * index.html is at <ext-root>/client/index.html, so parent of client/ = extension root.
 */
function getExtensionRoot() {
    const path = require('path');
    const fs = require('fs');

    // Method 1: Derive from window.location (most reliable - we KNOW where index.html is)
    try {
        const htmlUrl = decodeURIComponent(window.location.pathname);
        // On Windows: /C:/Users/... → remove leading slash
        const htmlPath = process.platform === 'win32' ? htmlUrl.replace(/^\//, '') : htmlUrl;
        const clientDir = path.dirname(htmlPath); // <ext>/client/
        const extRoot = path.dirname(clientDir);   // <ext>/
        console.log('Extension root (window.location):', extRoot);
        if (fs.existsSync(path.join(extRoot, 'version.json'))) {
            return extRoot;
        }
        // Even if version.json missing, this path is still correct
        return extRoot;
    } catch (e) {
        console.warn('window.location method failed:', e.message);
    }

    // Method 2: Use CSInterface
    try {
        const csInterface = new CSInterface();
        const extPath = csInterface.getSystemPath('extension');
        if (extPath && extPath.length > 0) {
            // CSInterface may return path with file:/// prefix or Unix-style on Windows
            let cleanPath = extPath.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
            cleanPath = decodeURIComponent(cleanPath);
            console.log('Extension root (CSInterface):', cleanPath);
            return cleanPath;
        }
    } catch (e) { }

    // Method 3: Try __dirname with various offsets
    try {
        const candidates = [
            path.resolve(__dirname, '../'),
            path.resolve(__dirname, '../../'),
            __dirname
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(path.join(candidate, 'version.json'))) {
                console.log('Extension root (__dirname probe):', candidate);
                return candidate;
            }
        }
    } catch (e) { }

    // Last resort
    console.warn('Could not determine extension root');
    return path.resolve(__dirname, '../');
}

/**
 * Get the local version from the bundled version.json
 */
function getLocalVersion() {
    try {
        const fs = require('fs');
        const path = require('path');

        const extensionRoot = getExtensionRoot();
        const versionFile = path.join(extensionRoot, 'version.json');
        console.log('Looking for version.json at:', versionFile);

        if (fs.existsSync(versionFile)) {
            const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
            console.log('Local version found:', data.version);
            return data;
        } else {
            console.warn('version.json NOT FOUND at:', versionFile);
            // Debug: list what IS in the extension root
            try {
                const files = fs.readdirSync(extensionRoot);
                console.log('Files in extension root:', files.join(', '));
            } catch (e2) {
                console.warn('Cannot list extension root:', e2.message);
            }
        }
    } catch (e) {
        console.warn('Could not read local version:', e.message);
    }
    return { version: '0.0.0' };
}
window.getLocalVersion = getLocalVersion;

/**
 * Check for updates (can be called manually or on startup)
 * @param {boolean} showNoUpdateMessage - Show message if no update available
 * @returns {Promise<{hasUpdate: boolean, version?: string, changelog?: string}>}
 */
async function checkForUpdates(showNoUpdateMessage = false) {
    if (updateCheckInProgress) {
        console.log('Update check already in progress, resetting...');
        // Don't block forever - reset and proceed
        updateCheckInProgress = false;
    }

    if (!UPDATE_CONFIG.enabled) {
        console.log('Update checks are disabled');
        return { hasUpdate: false };
    }

    updateCheckInProgress = true;
    lastUpdateCheck = new Date();

    // Show immediate feedback when manually triggered
    if (showNoUpdateMessage) {
        showErrorNotification('Checking for updates...');
    }

    try {
        const localData = getLocalVersion();
        const localVersion = localData.version || '0.0.0';
        console.log(`🔄 Current extension version: v${localVersion}`);
        console.log(`📡 Update mode: ${UPDATE_CONFIG.mode}`);

        const urls = getUpdateUrls();
        console.log(`📡 Fetching: ${urls.versionUrl}`);

        // Fetch remote version (tries Node.js https, then browser fetch)
        const remoteText = await fetchRemoteText(urls.versionUrl + '?t=' + Date.now());
        console.log('Remote response:', remoteText.substring(0, 200));
        const remoteData = JSON.parse(remoteText);
        const remoteVersion = remoteData.version;
        console.log(`📡 Latest version available: v${remoteVersion}`);

        if (compareVersions(remoteVersion, localVersion) > 0) {
            // New version available!
            console.log(`🔔 Update available: v${localVersion} → v${remoteVersion}`);

            availableUpdate = {
                currentVersion: localVersion,
                newVersion: remoteVersion,
                changelog: remoteData.changelog || '',
                releaseDate: remoteData.releaseDate || '',
                downloadUrl: remoteData.downloadUrl || ''
            };

            // Show update modal
            showUpdateModal(availableUpdate);

            // Also show banner as fallback
            showUpdateBanner(remoteVersion, remoteData.changelog || '');

            updateCheckInProgress = false;
            return { hasUpdate: true, version: remoteVersion, changelog: remoteData.changelog };
        } else {
            console.log('✅ Extension is up to date');
            availableUpdate = null;

            if (showNoUpdateMessage) {
                showNoUpdateNotification(localVersion);
            }

            updateCheckInProgress = false;
            return { hasUpdate: false, version: localVersion };
        }
    } catch (e) {
        console.error('❌ Update check FAILED:', e.message);
        updateCheckInProgress = false;
        if (showNoUpdateMessage) {
            showErrorNotification('Update check failed: ' + e.message);
        }
        return { hasUpdate: false, error: e.message };
    }
}
window.checkForUpdates = checkForUpdates;

/**
 * Show update available modal (more prominent than banner)
 */
function showUpdateModal(updateInfo) {
    // Check if modal exists, create if not
    let modal = document.getElementById('modal-update-available');
    if (!modal) {
        modal = createUpdateModal();
        document.body.appendChild(modal);
    }

    // Populate modal content
    const versionEl = document.getElementById('update-modal-version');
    const changelogEl = document.getElementById('update-modal-changelog');
    const releaseDateEl = document.getElementById('update-modal-date');
    const currentVersionEl = document.getElementById('update-modal-current');

    if (versionEl) versionEl.textContent = `v${updateInfo.newVersion}`;
    if (currentVersionEl) currentVersionEl.textContent = `v${updateInfo.currentVersion}`;
    if (releaseDateEl) releaseDateEl.textContent = updateInfo.releaseDate || 'Recently';
    if (changelogEl) {
        changelogEl.textContent = updateInfo.changelog || 'Bug fixes and improvements';
    }

    // Show modal
    modal.classList.remove('hidden');
}

/**
 * Create the update modal HTML
 */
function createUpdateModal() {
    const modal = document.createElement('div');
    modal.id = 'modal-update-available';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content update-modal-content">
            <div class="modal-header">
                <h3>🎉 Update Available!</h3>
                <button class="modal-close" onclick="closeUpdateModal()">&times;</button>
            </div>
            <div class="update-modal-body">
                <div class="update-version-info">
                    <div class="version-badge">
                        <span class="version-current" id="update-modal-current">v1.0.0</span>
                        <span class="version-arrow">→</span>
                        <span class="version-new" id="update-modal-version">v1.1.0</span>
                    </div>
                    <div class="release-date" id="update-modal-date">Released: Recently</div>
                </div>
                <div class="changelog-section">
                    <h4>What's New:</h4>
                    <p class="changelog-text" id="update-modal-changelog">Bug fixes and improvements</p>
                </div>
                <div class="update-progress-section hidden" id="update-modal-progress">
                    <div class="progress-bar-container">
                        <div id="update-modal-progress-fill" class="progress-bar-fill" style="width: 0%"></div>
                    </div>
                    <span id="update-modal-status">Preparing update...</span>
                </div>
            </div>
            <div class="modal-actions update-modal-actions">
                <button class="btn btn-secondary" onclick="closeUpdateModal()">Later</button>
                <button class="btn btn-primary" id="btn-modal-update" onclick="performAutoUpdate()">
                    ⬇️ Update Now
                </button>
            </div>
        </div>
    `;

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeUpdateModal();
    });

    return modal;
}

/**
 * Close update modal
 */
function closeUpdateModal() {
    const modal = document.getElementById('modal-update-available');
    if (modal) modal.classList.add('hidden');
}
window.closeUpdateModal = closeUpdateModal;

/**
 * Show notification when no update is available
 */
function showNoUpdateNotification(currentVersion) {
    const notification = document.createElement('div');
    notification.className = 'update-notification success';
    notification.innerHTML = `
        <span>✅ You're up to date! (v${currentVersion})</span>
    `;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2d4a3e;
        color: #51cf66;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

/**
 * Show the update banner (fallback UI)
 */
function showUpdateBanner(newVersion, changelog) {
    const banner = document.getElementById('update-banner');
    const versionText = document.getElementById('update-version-text');

    if (banner) {
        banner.classList.remove('hidden');
        if (versionText) {
            versionText.textContent = `v${newVersion}${changelog ? ' — ' + changelog : ''}`;
        }
    }
}

/**
 * Dismiss the update banner
 */
function dismissUpdate() {
    const banner = document.getElementById('update-banner');
    if (banner) banner.classList.add('hidden');
}
window.dismissUpdate = dismissUpdate;

/**
 * Perform the auto-update: download all extension files and overwrite
 */
async function performAutoUpdate() {
    // Get UI elements (support both banner and modal)
    const bannerBtn = document.getElementById('btn-update-now');
    const modalBtn = document.getElementById('btn-modal-update');
    const bannerProgress = document.getElementById('update-progress');
    const bannerProgressFill = document.getElementById('update-progress-fill');
    const bannerStatusText = document.getElementById('update-status-text');
    const modalProgress = document.getElementById('update-modal-progress');
    const modalProgressFill = document.getElementById('update-modal-progress-fill');
    const modalStatusText = document.getElementById('update-modal-status');

    // Disable buttons
    if (bannerBtn) {
        bannerBtn.disabled = true;
        bannerBtn.textContent = 'Updating...';
    }
    if (modalBtn) {
        modalBtn.disabled = true;
        modalBtn.textContent = 'Updating...';
    }

    // Show progress
    if (bannerProgress) bannerProgress.classList.remove('hidden');
    if (modalProgress) modalProgress.classList.remove('hidden');

    function updateProgress(percent, status) {
        if (bannerProgressFill) bannerProgressFill.style.width = `${percent}%`;
        if (modalProgressFill) modalProgressFill.style.width = `${percent}%`;
        if (bannerStatusText) bannerStatusText.textContent = status;
        if (modalStatusText) modalStatusText.textContent = status;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const https = require('https');

        // Extension root directory (where files need to be overwritten)
        const extensionRoot = getExtensionRoot();
        console.log(`📁 Extension root: ${extensionRoot}`);

        // Step 1: Get the file list
        updateProgress(5, 'Fetching file list...');

        const urls = getUpdateUrls();
        const fileList = await getFileList(urls);
        console.log(`📋 Found ${fileList.length} files to update`);

        // Step 2: Download and overwrite each file
        let completed = 0;
        const total = fileList.length;

        for (const file of fileList) {
            const relativePath = file.path.replace('dist/premiere-extension/', '').replace(/^\//, '');
            const targetPath = path.join(extensionRoot, relativePath);

            updateProgress(5 + (completed / total) * 85, `Updating ${relativePath}...`);

            try {
                // Ensure directory exists
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // Download file
                const downloadUrl = file.download_url || `${urls.rawBaseUrl}/${relativePath}`;
                const fileContent = await downloadFileBuffer(downloadUrl);
                fs.writeFileSync(targetPath, fileContent);

                completed++;
                console.log(`  ✅ Updated: ${relativePath}`);
            } catch (fileErr) {
                console.error(`  ❌ Failed: ${relativePath}`, fileErr.message);
            }
        }

        // Step 3: Update local version.json to prevent repeated update prompts
        try {
            const versionFile = path.join(extensionRoot, 'version.json');
            const newVersionData = {
                version: availableUpdate ? availableUpdate.newVersion : '0.0.0',
                releaseDate: availableUpdate ? availableUpdate.releaseDate : new Date().toISOString().split('T')[0],
                changelog: availableUpdate ? availableUpdate.changelog : 'Updated'
            };
            fs.writeFileSync(versionFile, JSON.stringify(newVersionData, null, 4));
            console.log(`✅ Updated local version.json to v${newVersionData.version}`);
        } catch (versionErr) {
            console.warn('Could not update version.json:', versionErr.message);
        }

        // Step 4: Done!
        updateProgress(100, `✅ Updated ${completed}/${total} files. Restart Premiere to apply!`);

        if (bannerBtn) {
            bannerBtn.textContent = '✅ Updated!';
            bannerBtn.disabled = true;
        }
        if (modalBtn) {
            modalBtn.textContent = '✅ Updated!';
            modalBtn.disabled = true;
        }

        // Clear the available update flag
        availableUpdate = null;

        // Show restart prompt
        setTimeout(() => {
            const shouldRestart = confirm(
                'Update complete!\n\n' +
                `Updated ${completed} of ${total} files.\n\n` +
                'Restart Premiere Pro to apply changes?'
            );
            if (shouldRestart) {
                alert('Please close and reopen Premiere Pro to use the updated extension.');
            }
            closeUpdateModal();
        }, 1000);

    } catch (e) {
        console.error('Auto-update failed:', e);
        updateProgress(0, `❌ Update failed: ${e.message}`);

        if (bannerBtn) {
            bannerBtn.disabled = false;
            bannerBtn.textContent = 'Retry Update';
        }
        if (modalBtn) {
            modalBtn.disabled = false;
            modalBtn.textContent = 'Retry Update';
        }
    }
}
window.performAutoUpdate = performAutoUpdate;

/**
 * Get file list from update source (GitHub API or local test server)
 */
async function getFileList(urls) {
    if (UPDATE_CONFIG.mode === 'local') {
        // Local mode: expects a JSON array directly
        const response = await fetch(urls.repoBaseUrl + '?t=' + Date.now());
        if (!response.ok) throw new Error(`File list error: ${response.status}`);
        return await response.json();
    } else {
        // GitHub mode: recursive API calls
        return await getGitHubFileList(urls.repoBaseUrl);
    }
}

/**
 * Get file list from GitHub API (recursive)
 */
async function getGitHubFileList(apiUrl, allFiles = []) {
    const response = await fetch(apiUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
    }

    const items = await response.json();

    for (const item of items) {
        if (item.type === 'file') {
            allFiles.push({
                path: item.path,
                download_url: item.download_url,
                sha: item.sha
            });
        } else if (item.type === 'dir') {
            // Recurse into subdirectories
            await getGitHubFileList(item.url, allFiles);
        }
    }

    return allFiles;
}

/**
 * Download a file as a Buffer
 */
function downloadFileBuffer(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? require('https') : require('http');

        protocol.get(url, { headers: { 'User-Agent': 'TeamSync-Extension' } }, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFileBuffer(response.headers.location).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Initialize update checker
 */
function initUpdateChecker() {
    // Load saved mode preference
    loadUpdateMode();

    console.log(`🔧 Update checker initialized (mode: ${UPDATE_CONFIG.mode})`);

    // Run update check after startup delay
    if (UPDATE_CONFIG.enabled && UPDATE_CONFIG.startupDelay > 0) {
        setTimeout(() => {
            checkForUpdates(false).catch(err => console.warn('Update check error:', err));
        }, UPDATE_CONFIG.startupDelay);
    }

    // Setup periodic checks if configured
    if (UPDATE_CONFIG.checkInterval > 0) {
        setInterval(() => {
            checkForUpdates(false).catch(err => console.warn('Periodic update check error:', err));
        }, UPDATE_CONFIG.checkInterval);
    }
}

// Add CSS for animations
const updateStyles = document.createElement('style');
updateStyles.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }

    .update-modal-content {
        max-width: 400px;
    }

    .update-modal-body {
        padding: 20px 0;
    }

    .update-version-info {
        text-align: center;
        margin-bottom: 20px;
    }

    .version-badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        background: var(--bg-secondary, #2d2d2d);
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 16px;
    }

    .version-current {
        color: #888;
    }

    .version-arrow {
        color: var(--accent, #0078d4);
    }

    .version-new {
        color: var(--accent, #0078d4);
        font-weight: bold;
    }

    .release-date {
        margin-top: 8px;
        color: #888;
        font-size: 12px;
    }

    .changelog-section {
        background: var(--bg-secondary, #2d2d2d);
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 15px;
    }

    .changelog-section h4 {
        margin: 0 0 8px 0;
        font-size: 13px;
        color: #aaa;
    }

    .changelog-text {
        margin: 0;
        color: #fff;
        line-height: 1.5;
    }

    .update-progress-section {
        margin-top: 15px;
    }

    .update-modal-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
    }
`;
document.head.appendChild(updateStyles);

/**
 * Toggle between local and remote update mode (for dev UI checkbox)
 */
function toggleUpdateMode(checkbox) {
    const mode = checkbox.checked ? 'local' : 'remote';
    setUpdateMode(mode);
}
window.toggleUpdateMode = toggleUpdateMode;

/**
 * Update the settings modal with current version info
 */
function updateSettingsVersion() {
    const versionEl = document.getElementById('settings-version');
    const modeToggle = document.getElementById('toggle-update-mode');

    if (versionEl) {
        const localData = getLocalVersion();
        versionEl.textContent = `v${localData.version || '0.0.0'}`;
    }

    if (modeToggle) {
        modeToggle.checked = UPDATE_CONFIG.mode === 'local';
    }
}

// Initialize on load
initUpdateChecker();

// Update settings when modal opens
document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', updateSettingsVersion);
    }
});
