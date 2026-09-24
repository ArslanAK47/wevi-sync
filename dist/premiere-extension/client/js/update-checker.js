/**
 * Auto-Update for Team Sync Extension
 *
 * Flow:
 * 1. Read local version.json; fetch remote version.json (GitHub raw, cache-busted).
 * 2. Checked on startup, every 30 min, and when the panel regains focus (≥5 min apart).
 * 3. Newer version → MANDATORY full-panel gate (no "Later"). If a push/pull is
 *    running, the gate waits until it finishes.
 * 4. Update Now → download every file listed in dist files.json into a staging
 *    folder, verify size + sha256, and only when ALL files pass copy them into
 *    place. version.json is written LAST, so a failed/partial update is never
 *    mistaken for a finished one and the gate re-appears.
 * 5. A failed CHECK (offline, GitHub down) never blocks work: a small warning
 *    banner with Retry is shown instead.
 *
 * Releases are published with release.bat (scripts/release.js) which bumps the
 * version, builds dist/, writes files.json and pushes.
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
        repoBaseUrl: 'http://localhost:8888/files.json', // legacy file list (no hashes)
        rawBaseUrl: 'http://localhost:8888/files'
    },
    // Active mode: 'remote' or 'local'
    mode: 'remote',
    checkInterval: 30 * 60 * 1000,
    focusCheckMinGap: 5 * 60 * 1000,
    startupDelay: 3000,
    enabled: true
};

// State (UpdateState is read by the settings panel, telemetry and the admin view)
const UpdateState = {
    status: 'idle',        // idle | checking | up-to-date | available | failed | updating | installed
    localVersion: null,
    latestVersion: null,
    lastCheckedAt: null,
    error: ''
};
window.UpdateState = UpdateState;

let updateCheckInProgress = null;
let availableUpdate = null;
let gateWaitTimer = null;

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

    try {
        return await xhrGet(url);
    } catch (e) {
        console.warn('[Update] XMLHttpRequest failed:', e.message);
        errors.push('XHR: ' + e.message);
    }

    try {
        return await nodeHttpGet(url);
    } catch (e) {
        console.warn('[Update] Node.js https failed:', e.message);
        errors.push('Node: ' + e.message);
    }

    try {
        return await browserFetchGet(url);
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
    const colors = {
        error: ['#4a2d2d', '#ff6b6b'],
        success: ['#2d4a3e', '#51cf66'],
        info: ['#2d3a4a', '#6bb5ff']
    }[type] || ['#2d3a4a', '#6bb5ff'];
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${colors[0]}; color: ${colors[1]};
        padding: 12px 20px; border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000; max-width: 400px; font-size: 12px;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, type === 'success' ? 3000 : 6000);
}

/**
 * Switch between local and remote update sources (for testing)
 */
function setUpdateMode(mode) {
    if (mode === 'local' || mode === 'remote') {
        UPDATE_CONFIG.mode = mode;
        console.log(`🔧 Update mode set to: ${mode}`);
        try {
            localStorage.setItem('update_mode', mode);
        } catch (e) { }
        return true;
    }
    return false;
}
window.setUpdateMode = setUpdateMode;

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
        return path.dirname(clientDir);           // <ext>/
    } catch (e) {
        console.warn('window.location method failed:', e.message);
    }

    // Method 2: Use CSInterface
    try {
        const csInterface = new CSInterface();
        const extPath = csInterface.getSystemPath('extension');
        if (extPath && extPath.length > 0) {
            let cleanPath = extPath.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
            return decodeURIComponent(cleanPath);
        }
    } catch (e) { }

    // Method 3: Try __dirname with various offsets
    try {
        const candidates = [path.resolve(__dirname, '../'), path.resolve(__dirname, '../../'), __dirname];
        for (const candidate of candidates) {
            if (fs.existsSync(path.join(candidate, 'version.json'))) return candidate;
        }
    } catch (e) { }

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
        const versionFile = path.join(getExtensionRoot(), 'version.json');
        if (fs.existsSync(versionFile)) {
            return JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        }
        console.warn('version.json NOT FOUND at:', versionFile);
    } catch (e) {
        console.warn('Could not read local version:', e.message);
    }
    return { version: '0.0.0' };
}
window.getLocalVersion = getLocalVersion;

function isSyncBusy() {
    try {
        return (typeof isPushing !== 'undefined' && isPushing) || (typeof isPulling !== 'undefined' && isPulling);
    } catch (e) {
        return false;
    }
}

function noteTelemetry(fields) {
    if (typeof Telemetry !== 'undefined') Telemetry.noteUpdate(fields);
}

/**
 * Check for updates (startup, interval, focus, or the Settings button)
 * @param {boolean} manual - Show feedback toasts (Settings → Check for Updates)
 * @returns {Promise<{hasUpdate: boolean, version?: string, error?: string}>}
 */
function checkForUpdates(manual = false) {
    if (!UPDATE_CONFIG.enabled) return Promise.resolve({ hasUpdate: false });
    if (UpdateState.status === 'updating') return Promise.resolve({ hasUpdate: true, version: UpdateState.latestVersion });
    if (updateCheckInProgress) return updateCheckInProgress;

    updateCheckInProgress = runUpdateCheck(manual).finally(() => { updateCheckInProgress = null; });
    return updateCheckInProgress;
}
window.checkForUpdates = checkForUpdates;

async function runUpdateCheck(manual) {
    if (manual) showNotification('Checking for updates...', 'info');
    UpdateState.status = 'checking';
    renderUpdateStatus();

    try {
        const localVersion = getLocalVersion().version || '0.0.0';
        UpdateState.localVersion = localVersion;

        const urls = getUpdateUrls();
        const remoteText = await fetchRemoteText(urls.versionUrl + '?t=' + Date.now());
        const remoteData = JSON.parse(remoteText);
        const remoteVersion = remoteData.version;
        if (!remoteVersion) throw new Error('Remote version.json has no version');

        UpdateState.latestVersion = remoteVersion;
        UpdateState.lastCheckedAt = new Date().toISOString();
        UpdateState.error = '';
        hideCheckFailedBanner();

        if (UpdateCore.compareVersions(remoteVersion, localVersion) > 0) {
            console.log(`🔔 Update available: v${localVersion} → v${remoteVersion}`);
            availableUpdate = {
                currentVersion: localVersion,
                newVersion: remoteVersion,
                changelog: remoteData.changelog || '',
                releaseDate: remoteData.releaseDate || '',
                downloadUrl: remoteData.downloadUrl || '',
                versionData: remoteData
            };
            UpdateState.status = 'available';
            renderUpdateStatus();
            noteTelemetry({ lastCheckAt: UpdateState.lastCheckedAt, lastCheckResult: 'update available: v' + remoteVersion });
            showUpdateGateWhenIdle();
            return { hasUpdate: true, version: remoteVersion, changelog: remoteData.changelog };
        }

        console.log(`✅ Extension is up to date (v${localVersion})`);
        availableUpdate = null;
        UpdateState.status = 'up-to-date';
        renderUpdateStatus();
        noteTelemetry({ lastCheckAt: UpdateState.lastCheckedAt, lastCheckResult: 'up to date' });
        if (manual) showNotification(`✅ You're up to date! (v${localVersion})`, 'success');
        return { hasUpdate: false, version: localVersion };
    } catch (e) {
        console.error('❌ Update check FAILED:', e.message);
        UpdateState.status = 'failed';
        UpdateState.error = e.message;
        UpdateState.lastCheckedAt = new Date().toISOString();
        renderUpdateStatus();
        showCheckFailedBanner(e.message);
        noteTelemetry({ lastCheckAt: UpdateState.lastCheckedAt, lastCheckResult: 'failed: ' + e.message });
        if (manual) showNotification('Update check failed: ' + e.message, 'error');
        return { hasUpdate: false, error: e.message };
    }
}

/* ============================================
   MANDATORY UPDATE GATE
   ============================================ */

function showUpdateGateWhenIdle() {
    if (!availableUpdate) return;
    if (isSyncBusy()) {
        // Never interrupt a push/pull. Poll until it's done, then block.
        if (!gateWaitTimer) {
            console.log('[Update] Sync in progress — update screen will appear when it finishes');
            gateWaitTimer = setInterval(() => {
                if (!isSyncBusy()) {
                    clearInterval(gateWaitTimer);
                    gateWaitTimer = null;
                    showUpdateGate();
                }
            }, 5000);
        }
        return;
    }
    showUpdateGate();
}

function getUpdateGate() {
    let gate = document.getElementById('update-gate');
    if (gate) return gate;

    gate = document.createElement('div');
    gate.id = 'update-gate';
    gate.className = 'update-gate hidden';
    gate.innerHTML = `
        <div class="update-gate-card">
            <div class="update-gate-icon">⬆️</div>
            <h2>Update required</h2>
            <p class="update-gate-sub">A new version of Team Sync is out. Install it to keep using the panel.</p>
            <div class="version-badge">
                <span class="version-current" id="update-gate-current">v0.0.0</span>
                <span class="version-arrow">→</span>
                <span class="version-new" id="update-gate-new">v0.0.0</span>
            </div>
            <div class="changelog-section">
                <h4>What's new</h4>
                <p class="changelog-text" id="update-gate-changelog"></p>
            </div>
            <div class="update-progress-section hidden" id="update-gate-progress">
                <div class="progress-bar-container">
                    <div id="update-gate-progress-fill" class="progress-bar-fill" style="width: 0%"></div>
                </div>
                <span id="update-gate-status">Preparing update...</span>
            </div>
            <p class="update-gate-error hidden" id="update-gate-error"></p>
            <div class="update-gate-actions">
                <button class="btn btn-secondary btn-small hidden" id="btn-gate-copy-log">📋 Copy debug log</button>
                <button class="btn btn-primary" id="btn-gate-update">⬇️ Update Now</button>
            </div>
        </div>
    `;
    document.body.appendChild(gate);
    document.getElementById('btn-gate-update').addEventListener('click', onGatePrimaryClick);
    document.getElementById('btn-gate-copy-log').addEventListener('click', copyLogForSupport);
    return gate;
}

function showUpdateGate() {
    if (!availableUpdate) return;
    const gate = getUpdateGate();
    document.getElementById('update-gate-current').textContent = `v${availableUpdate.currentVersion}`;
    document.getElementById('update-gate-new').textContent = `v${availableUpdate.newVersion}`;
    document.getElementById('update-gate-changelog').textContent = availableUpdate.changelog || 'Bug fixes and improvements';
    setGateError('');
    const btn = document.getElementById('btn-gate-update');
    btn.disabled = false;
    btn.textContent = '⬇️ Update Now';
    btn.dataset.action = 'update';
    gate.classList.remove('hidden');
}

function setGateProgress(percent, status) {
    const box = document.getElementById('update-gate-progress');
    if (!box) return;
    box.classList.remove('hidden');
    document.getElementById('update-gate-progress-fill').style.width = `${percent}%`;
    document.getElementById('update-gate-status').textContent = status;
}

function setGateError(message) {
    const el = document.getElementById('update-gate-error');
    const copyBtn = document.getElementById('btn-gate-copy-log');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    if (copyBtn) copyBtn.classList.toggle('hidden', !message);
}

function onGatePrimaryClick() {
    const btn = document.getElementById('btn-gate-update');
    if (btn.dataset.action === 'reload') {
        window.location.reload();
        return;
    }
    performAutoUpdate();
}

function copyLogForSupport() {
    const lines = (typeof debugLogs !== 'undefined' ? debugLogs : []);
    const text = (typeof Telemetry !== 'undefined' ? Telemetry.trimLog(lines, 3000) : lines).join('\n');
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showNotification('Debug log copied — paste it to your admin', 'success'); }
    catch (e) { showNotification('Could not copy the log', 'error'); }
    ta.remove();
}

/* ============================================
   NON-BLOCKING "CHECK FAILED" BANNER
   ============================================ */

function showCheckFailedBanner(reason) {
    const banner = document.getElementById('update-check-failed');
    if (!banner) return;
    const text = document.getElementById('update-check-failed-text');
    if (text) text.textContent = 'Couldn\'t check for updates (' + reason.slice(0, 120) + ')';
    banner.classList.remove('hidden');
}

function hideCheckFailedBanner() {
    const banner = document.getElementById('update-check-failed');
    if (banner) banner.classList.add('hidden');
}

/** Settings → Updates status line */
function renderUpdateStatus() {
    const el = document.getElementById('settings-update-status');
    if (!el) return;
    const when = UpdateState.lastCheckedAt ? new Date(UpdateState.lastCheckedAt).toLocaleTimeString() : 'never';
    const msg = {
        idle: 'Not checked yet',
        checking: 'Checking…',
        'up-to-date': `Up to date · last checked ${when}`,
        available: `v${UpdateState.latestVersion} available · checked ${when}`,
        failed: `Check failed (${UpdateState.error}) · ${when}`,
        updating: `Installing v${UpdateState.latestVersion}…`,
        installed: `v${UpdateState.latestVersion} installed — reload the panel`
    }[UpdateState.status] || '';
    el.textContent = msg;
}

/* ============================================
   INSTALLING AN UPDATE
   ============================================ */

// fs.rmSync needs Node 14.14+; Premiere 2020 (CEP 10) ships Node 12.
function removeDirRecursive(dir) {
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.lstatSync(p).isDirectory()) removeDirRecursive(p);
        else fs.unlinkSync(p);
    }
    fs.rmdirSync(dir);
}

function sha256Hex(buffer) {
    return require('crypto').createHash('sha256').update(buffer).digest('hex');
}

function readInstalledManifest(extensionRoot) {
    try {
        const fs = require('fs');
        const p = require('path').join(extensionRoot, UpdateCore.MANIFEST_NAME);
        if (!fs.existsSync(p)) return [];
        return UpdateCore.parseManifest(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch (e) {
        return [];
    }
}

/**
 * Resolve what to download. Prefers the release's files.json (with hashes);
 * falls back to the legacy listing (GitHub Contents API / local test server)
 * for releases published before files.json existed.
 */
async function resolveUpdateFiles(rawBase, expectedVersion) {
    let text = null;
    try {
        text = await fetchRemoteText(`${rawBase}/${UpdateCore.MANIFEST_NAME}?t=${Date.now()}`);
    } catch (e) {
        console.warn('[Update] files.json unavailable, using legacy file list:', e.message);
    }
    if (text !== null) {
        const manifestObj = JSON.parse(text);
        // GitHub's CDN can briefly serve the previous release's manifest; installing
        // it under the new version number would strand the editor on old code.
        if (manifestObj.version && manifestObj.version !== expectedVersion) {
            throw new Error(`The v${expectedVersion} release is still being published (server has v${manifestObj.version} files). Try again in a few minutes.`);
        }
        return { entries: UpdateCore.parseManifest(manifestObj), manifestText: text, verified: true };
    }
    const legacy = await getFileList(getUpdateUrls());
    const entries = legacy
        .map(f => ({
            path: f.path.replace('dist/premiere-extension/', '').replace(/^\//, ''),
            size: typeof f.size === 'number' ? f.size : null,
            download_url: f.download_url
        }))
        .filter(f => UpdateCore.isSafeRelPath(f.path) && f.path !== 'version.json' && f.path !== 'files.json');
    if (entries.length === 0) throw new Error('Update file list is empty');
    return { entries, manifestText: null, verified: false };
}

async function performAutoUpdate() {
    if (!availableUpdate || UpdateState.status === 'updating') return;
    const btn = document.getElementById('btn-gate-update');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
    setGateError('');
    UpdateState.status = 'updating';
    renderUpdateStatus();

    const fs = require('fs');
    const path = require('path');
    const target = availableUpdate;
    const attemptAt = new Date().toISOString();

    try {
        const extensionRoot = getExtensionRoot();
        const stagingRoot = path.join(extensionRoot, '.update-staging');
        const rawBase = target.downloadUrl || getUpdateUrls().rawBaseUrl;
        console.log(`[Update] Installing v${target.newVersion} into ${extensionRoot}`);

        setGateProgress(3, 'Fetching file list...');
        const { entries, manifestText, verified } = await resolveUpdateFiles(rawBase, target.newVersion);
        const oldEntries = readInstalledManifest(extensionRoot);

        // Skip files that are already byte-identical (makes retries fast).
        const toFetch = entries.filter(entry => {
            if (!verified) return true;
            try {
                const local = path.join(extensionRoot, entry.path);
                if (!fs.existsSync(local)) return true;
                const buf = fs.readFileSync(local);
                return UpdateCore.verifyEntry(entry, buf.length, sha256Hex(buf)) !== null;
            } catch (e) { return true; }
        });

        // Phase 1: download + verify everything into staging. Nothing live is touched yet.
        removeDirRecursive(stagingRoot);
        const failures = [];
        for (let i = 0; i < toFetch.length; i++) {
            const entry = toFetch[i];
            setGateProgress(5 + (i / Math.max(1, toFetch.length)) * 75, `Downloading ${entry.path}...`);
            try {
                const url = entry.download_url || `${rawBase}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
                const buf = await downloadWithRetry(url);
                if (verified) {
                    const problem = UpdateCore.verifyEntry(entry, buf.length, sha256Hex(buf));
                    if (problem) throw new Error(problem);
                } else if (entry.size !== null && buf.length !== entry.size) {
                    throw new Error(`size mismatch (got ${buf.length}, expected ${entry.size})`);
                }
                const staged = path.join(stagingRoot, entry.path);
                fs.mkdirSync(path.dirname(staged), { recursive: true });
                fs.writeFileSync(staged, buf);
            } catch (e) {
                failures.push(`${entry.path}: ${e.message}`);
            }
        }
        if (failures.length > 0) {
            removeDirRecursive(stagingRoot);
            throw new Error(`${failures.length} file(s) failed to download — nothing was changed.\n` + failures.slice(0, 5).join('\n'));
        }

        // Phase 2: move staged files into place.
        setGateProgress(85, 'Installing...');
        for (const entry of toFetch) {
            const dest = path.join(extensionRoot, entry.path);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(stagingRoot, entry.path), dest);
        }
        removeDirRecursive(stagingRoot);

        // Remove files we shipped before but the new release no longer has.
        for (const rel of UpdateCore.removedPaths(oldEntries, entries)) {
            try { fs.unlinkSync(path.join(extensionRoot, rel)); console.log(`[Update] Removed ${rel}`); } catch (e) { }
        }

        // Phase 3: mark complete. version.json LAST.
        if (manifestText) fs.writeFileSync(path.join(extensionRoot, UpdateCore.MANIFEST_NAME), manifestText);
        fs.writeFileSync(path.join(extensionRoot, 'version.json'), JSON.stringify(target.versionData, null, 4));

        const hostChanged = UpdateCore.hostFilesChanged(toFetch);
        if (hostChanged) reloadHostScript(extensionRoot);

        console.log(`✅ Updated to v${target.newVersion} (${toFetch.length} changed file(s))`);
        UpdateState.status = 'installed';
        renderUpdateStatus();
        noteTelemetry({ lastAttemptAt: attemptAt, lastAttemptResult: `installed v${target.newVersion} (${toFetch.length} files)` });

        setGateProgress(100, hostChanged
            ? `✅ v${target.newVersion} installed. Reload the panel now; if something looks off, restart Premiere.`
            : `✅ v${target.newVersion} installed. Reload the panel to finish.`);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔄 Reload panel';
            btn.dataset.action = 'reload';
        }
    } catch (e) {
        console.error('Auto-update failed:', e.message);
        UpdateState.status = 'available';
        renderUpdateStatus();
        noteTelemetry({ lastAttemptAt: attemptAt, lastAttemptResult: 'failed: ' + e.message.split('\n')[0] });
        setGateProgress(0, 'Update failed');
        setGateError(e.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔁 Retry Update';
            btn.dataset.action = 'update';
        }
    }
}
window.performAutoUpdate = performAutoUpdate;

/** Re-evaluate host/index.jsx so new ExtendScript functions load without restarting Premiere. */
function reloadHostScript(extensionRoot) {
    try {
        const jsx = require('path').join(extensionRoot, 'host', 'index.jsx').replace(/\\/g, '/');
        new CSInterface().evalScript(`$.evalFile(${JsxEscape.jsxString(jsx)})`);
    } catch (e) {
        console.warn('[Update] Could not reload host script:', e.message);
    }
}

async function downloadWithRetry(url, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await downloadFileBuffer(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
        } catch (e) {
            lastErr = e;
            if (i < attempts) await new Promise(r => setTimeout(r, i * 1000));
        }
    }
    throw lastErr;
}

/**
 * Legacy file list from update source (GitHub API or local test server)
 */
async function getFileList(urls) {
    if (UPDATE_CONFIG.mode === 'local') {
        return JSON.parse(await fetchRemoteText(urls.repoBaseUrl + '?t=' + Date.now()));
    }
    return await getGitHubFileList(urls.repoBaseUrl);
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
            allFiles.push({ path: item.path, download_url: item.download_url, size: item.size });
        } else if (item.type === 'dir') {
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

        const req = protocol.get(url, { headers: { 'User-Agent': 'TeamSync-Extension' }, timeout: 30000 }, (response) => {
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
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout (30s)')); });
    });
}

/**
 * Initialize update checker
 */
function initUpdateChecker() {
    loadUpdateMode();
    console.log(`🔧 Update checker initialized (mode: ${UPDATE_CONFIG.mode})`);
    if (!UPDATE_CONFIG.enabled) return;

    setTimeout(() => checkForUpdates(false), UPDATE_CONFIG.startupDelay);
    setInterval(() => checkForUpdates(false), UPDATE_CONFIG.checkInterval);

    // Premiere is often left open all day: re-check when the editor comes back to the panel.
    window.addEventListener('focus', () => {
        const last = UpdateState.lastCheckedAt ? Date.parse(UpdateState.lastCheckedAt) : 0;
        if (Date.now() - last >= UPDATE_CONFIG.focusCheckMinGap) checkForUpdates(false);
    });
}

// Add CSS for animations + the update gate
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

    .update-gate {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 20000;
        background: rgba(15, 15, 15, 0.96);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; overflow-y: auto;
    }
    .update-gate.hidden { display: none; }
    .update-gate-card {
        width: 100%; max-width: 420px; text-align: center;
        background: var(--bg-primary, #232323);
        border: 1px solid #3a3a3a; border-radius: 10px; padding: 24px 20px;
    }
    .update-gate-icon { font-size: 32px; margin-bottom: 6px; }
    .update-gate-card h2 { margin: 0 0 6px; font-size: 18px; }
    .update-gate-sub { margin: 0 0 16px; color: #aaa; font-size: 12px; line-height: 1.5; }
    .update-gate-error {
        white-space: pre-wrap; text-align: left; font-size: 11px; color: #ff6b6b;
        background: #3a2626; border-radius: 6px; padding: 8px 10px; margin: 12px 0 0;
        max-height: 120px; overflow-y: auto;
    }
    .update-gate-actions { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }

    .version-badge {
        display: inline-flex; align-items: center; gap: 10px;
        background: var(--bg-secondary, #2d2d2d);
        padding: 8px 18px; border-radius: 20px; font-size: 15px; margin-bottom: 14px;
    }
    .version-current { color: #888; }
    .version-arrow { color: var(--accent, #0078d4); }
    .version-new { color: var(--accent, #0078d4); font-weight: bold; }

    .changelog-section {
        background: var(--bg-secondary, #2d2d2d);
        padding: 12px 14px; border-radius: 8px; text-align: left;
    }
    .changelog-section h4 { margin: 0 0 6px 0; font-size: 12px; color: #aaa; }
    .changelog-text { margin: 0; color: #fff; line-height: 1.5; font-size: 12px; }

    .update-progress-section { margin-top: 14px; font-size: 11px; color: #aaa; }
    .update-progress-section.hidden { display: none; }
    .update-progress-section .progress-bar-container { margin-bottom: 6px; }

    .update-check-failed {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        background: #4a3f22; color: #ffd166; font-size: 11px;
        padding: 6px 10px; border-radius: 6px; margin: 6px 0;
    }
    .update-check-failed.hidden { display: none; }
`;
document.head.appendChild(updateStyles);

/**
 * Update the settings modal with current version info
 */
function updateSettingsVersion() {
    const versionEl = document.getElementById('settings-version');
    if (versionEl) {
        versionEl.textContent = `v${getLocalVersion().version || '0.0.0'}`;
    }
    renderUpdateStatus();
}

// Initialize on load
initUpdateChecker();

// Update settings when modal opens + set version badges from version.json
document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', updateSettingsVersion);
    }

    try {
        const ver = 'v' + (getLocalVersion().version || '0.0.0');
        const headerBadge = document.getElementById('header-version-badge');
        const footerText = document.getElementById('footer-version-text');
        if (headerBadge) headerBadge.textContent = ver;
        if (footerText) footerText.textContent = ver;
    } catch (e) {
        console.warn('Could not set version badges:', e);
    }
});
