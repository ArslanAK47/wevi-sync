/* ============================================
   SYNC ENGINE WITH PROPER CEP FILE DIALOGS
   ============================================ */

const SyncEngine = {
    checkInterval: null,
    lastCheck: null,

    // Activity logging + project registration used to live on the admin server,
    // which is no longer part of the OAuth-based flow. Kept as no-ops so existing
    // callers don't error; Drive is now the source of truth.
    async logActivity(action, projectName = null) {
        console.log(`(activity) ${action}${projectName ? ': ' + projectName : ''}`);
        return { success: true };
    },

    async registerProject(projectName, projectPath, files = []) {
        // Projects are "registered" simply by being pushed to the Drive team folder.
        return { success: true };
    },

    _myEmail() {
        return (typeof Config !== 'undefined' && Config.data && Config.data.editorEmail) || '';
    },

    _myName() {
        return (typeof Config !== 'undefined' && Config.data && (Config.data.editorName || Config.data.editorEmail)) || 'Editor';
    },

    // Lock a project by writing a .wevisync.lock into its Drive folder.
    async lockProject(projectName) {
        try {
            const folder = await GoogleDrive.findProjectFolder({ cleanName: projectName });
            if (!folder) return { success: false, error: 'Project not found on Drive yet — push it first.' };

            const existing = await GoogleDrive.readLock(folder.id);
            const myEmail = this._myEmail();
            if (existing && existing.email && existing.email !== myEmail) {
                return {
                    success: false,
                    error: `Locked by ${existing.lockedBy || existing.email}`,
                    lockedBy: existing.lockedBy,
                    lockedAt: existing.lockedAt
                };
            }

            let host = '';
            try { host = require('os').hostname(); } catch (e) { }
            await GoogleDrive.writeLock(folder.id, {
                lockedBy: this._myName(),
                email: myEmail,
                lockedAt: new Date().toISOString(),
                host: host
            });
            return { success: true };
        } catch (error) {
            console.error('Error locking project:', error);
            return { success: false, error: error.message };
        }
    },

    // Unlock a project (only the owner can release; force-unlock passes force=true).
    async unlockProject(projectName, force = false) {
        try {
            const folder = await GoogleDrive.findProjectFolder({ cleanName: projectName });
            if (!folder) return { success: true };

            const existing = await GoogleDrive.readLock(folder.id);
            if (!force && existing && existing.email && existing.email !== this._myEmail()) {
                return { success: false, error: 'You do not own this lock' };
            }
            await GoogleDrive.deleteLock(folder.id);
            return { success: true };
        } catch (error) {
            console.error('Error unlocking project:', error);
            return { success: false, error: error.message };
        }
    },

    // Poll Drive for all current locks and return them in the render shape
    // ({ locks: [{ project_name, locked_by, ... }] }) the UI already expects.
    async getSyncState() {
        try {
            const teamFolderId = GoogleDrive.getTeamFolderId();
            const folders = await GoogleDrive.listProjects(teamFolderId);
            const byId = {};
            folders.forEach(f => { byId[f.id] = ProjectId.parseDriveFolderName(f.name).cleanName; });
            const lockFiles = await GoogleDrive.listLocks(folders.map(f => f.id));
            const entries = lockFiles.map(lf => ({ cleanName: byId[lf.parentId] || '', lock: lf.lock }));
            this.pollFailures = 0;
            return { locks: ProjectId.locksToRenderShape(entries), recentPushes: [] };
        } catch (error) {
            // Background poll: a dropped connection is retried in 30s, so it's a
            // warning (not the editor's "last error") unless it keeps happening.
            this.pollFailures = (this.pollFailures || 0) + 1;
            const offline = error instanceof TypeError && /fetch/i.test(error.message);
            if (offline && this.pollFailures < 3) {
                console.warn(`Drive unreachable (network), retrying in 30s [${this.pollFailures}]:`, error.message);
            } else {
                console.error(`Error fetching sync state (Drive), ${this.pollFailures} failure(s) in a row:`, error);
            }
            return null;
        }
    },

    async getLocks() {
        const state = await this.getSyncState();
        return state ? state.locks : [];
    },

    startPeriodicCheck(callback) {
        this.checkInterval = setInterval(async () => {
            const state = await this.getSyncState();
            this.lastCheck = new Date();
            if (callback) callback(state);
        }, 30000);

        this.getSyncState().then(state => {
            this.lastCheck = new Date();
            if (callback) callback(state);
        });
    },

    stopPeriodicCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
};

/* ============================================
   FILE SYSTEM HELPERS - FIXED FOR CEP
   ============================================ */

const FileSystem = {
    fs: null,
    path: null,
    csInterface: null,
    isCEP: false,
    _browsePending: false,  // Prevent multiple browse windows

    init() {
        console.log('FileSystem initializing...');

        // Check for CEP environment
        try {
            if (typeof CSInterface !== 'undefined') {
                this.csInterface = new CSInterface();
                this.isCEP = true;
                console.log('CSInterface available');
            }
        } catch (e) {
            console.log('CSInterface not available:', e);
        }

        // Check for cep.fs (native file system in CEP)
        if (typeof window.cep !== 'undefined' && window.cep.fs) {
            console.log('window.cep.fs available');
        }

        // Try Node.js modules
        try {
            if (typeof require !== 'undefined') {
                this.fs = require('fs');
                this.path = require('path');
                console.log('Node.js fs/path available');
            }
        } catch (e) {
            console.log('Node.js not available');
        }

        return this.isCEP;
    },

    /**
     * Make sure host/index.jsx is loaded in Premiere's ExtendScript engine.
     * Premiere normally evaluates it from the manifest's ScriptPath, but when it
     * doesn't (seen on Premiere 26: every call returns "EvalScript error.") we
     * load it ourselves and log the exact reason for the admin view.
     * @returns {Promise<{ok:boolean, reloaded?:boolean, reason?:string, detail?:string}>}
     */
    ensureHostScript() {
        if (this._hostCheck) return this._hostCheck;
        const ev = (script) => new Promise((resolve) => {
            try { this.csInterface.evalScript(script, (r) => resolve(String(r))); }
            catch (e) { resolve('JS error: ' + e.message); }
        });
        // Actually CALL a host function: "exists" isn't enough. All CEP panels share one
        // ExtendScript engine, so another extension can overwrite a same-named global
        // (getActiveProject...) or break JSON; the error text + function source tell which.
        const probe = () => ev(
            "(function(){ if (typeof getActiveProject !== 'function') return 'MISSING';" +
            " try { getActiveProject(); return 'OK'; }" +
            " catch (e) { return 'ERR: ' + e.message + ' (line ' + e.line + ') | JSON: ' + typeof JSON +" +
            " ' | getActiveProject is: ' + String(getActiveProject).substring(0, 160).replace(/\\s+/g, ' '); } })()");

        this._hostCheck = (async () => {
            if (!this.csInterface || typeof __adobe_cep__ === 'undefined') {
                console.warn('[Host] Not running inside Premiere; skipping host check');
                return { ok: false, reason: 'not running inside Premiere' };
            }

            const ping = await ev('1+1');
            if (ping !== '2') {
                console.error(`[Host] Premiere's script engine is not responding (1+1 returned "${ping}"). Restart Premiere.`);
                return { ok: false, reason: 'engine', detail: ping };
            }
            const first = await probe();
            if (first === 'OK') {
                console.log('[Host] host script OK');
                return { ok: true };
            }

            // Missing, or overwritten by another panel: (re)load ours so our definitions win.
            const jsx = require('path').join(getExtensionRoot(), 'host', 'index.jsx').replace(/\\/g, '/');
            console.warn(`[Host] host check failed (${first}); loading ${jsx}`);
            const loaded = await ev(
                `(function(){ try { $.evalFile(${JsxEscape.jsxString(jsx)}); return 'ok'; }` +
                ` catch (e) { return 'ERR: ' + e.message + ' (line ' + e.line + ')'; } })()`);
            const second = await probe();
            if (second === 'OK') {
                console.log('[Host] host script repaired by reloading it');
                return { ok: true, reloaded: true };
            }
            console.error(`[Host] host script still failing after reload: ${second} | reload: ${loaded} | first: ${first}`);
            return { ok: false, reason: 'load', detail: second };
        })();
        return this._hostCheck;
    },

    // Get current project from Premiere Pro
    getCurrentProjectInfo() {
        return new Promise((resolve) => {
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript('getActiveProject()', (result) => {
                        console.log('getActiveProject result:', result);
                        if (result && result !== 'undefined' && result !== 'null' && result !== '') {
                            try {
                                const parsed = JSON.parse(result);
                                if (!parsed.error) {
                                    resolve(parsed);
                                    return;
                                }
                            } catch (e) {
                                console.log('Parse error:', e);
                            }
                        }
                        resolve(null);
                    });
                } catch (e) {
                    console.error('evalScript error:', e);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    },

    // =============================================
    // FOLDER SELECTION - MULTIPLE METHODS
    // =============================================
    selectFolder() {
        return new Promise((resolve) => {
            // Prevent multiple dialogs
            if (this._browsePending) {
                console.log('Browse already pending, skipping');
                resolve(null);
                return;
            }
            this._browsePending = true;

            console.log('selectFolder called');

            // METHOD 1: Use window.cep.fs.showOpenDialog (most reliable for CEP)
            if (typeof window.cep !== 'undefined' && window.cep.fs && window.cep.fs.showOpenDialog) {
                console.log('Trying cep.fs.showOpenDialog...');
                try {
                    // Parameters: allowMultiple, chooseDirectory, title, initialPath, fileTypes
                    const result = window.cep.fs.showOpenDialog(
                        false,  // allowMultipleSelection
                        true,   // chooseDirectory (THIS IS THE KEY!)
                        'Select Sync Folder',  // title
                        '',     // initialPath (empty = last used)
                        []      // fileTypes (empty for folders)
                    );

                    console.log('showOpenDialog result:', result);

                    if (result && result.err === 0 && result.data && result.data.length > 0) {
                        this._browsePending = false;
                        resolve(result.data[0]);
                        return;
                    } else {
                        this._browsePending = false;
                        resolve(null);
                        return;
                    }
                } catch (e) {
                    console.error('cep.fs.showOpenDialog error:', e);
                }
            }

            // METHOD 2: Try CSInterface with ExtendScript
            if (this.csInterface) {
                console.log('Trying CSInterface evalScript...');
                try {
                    this.csInterface.evalScript(
                        '(function(){ var f = Folder.selectDialog("Select Sync Folder"); return f ? f.fsName : ""; })()',
                        (result) => {
                            this._browsePending = false;
                            console.log('evalScript folder result:', result);
                            if (result && result !== '' && result !== 'null' && result !== 'undefined') {
                                resolve(result);
                            } else {
                                resolve(null);
                            }
                        }
                    );
                    return;
                } catch (e) {
                    console.log('evalScript failed:', e);
                }
            }

            // METHOD 3: Manual prompt fallback
            this._browsePending = false;
            const path = prompt(
                'Enter the full path to your sync folder:',
                'G:\\My Drive\\Team Projects'
            );
            resolve(path || null);
        });
    },

    // =============================================
    // FILE SELECTION
    // =============================================
    selectFile(extensions = '.prproj') {
        return new Promise((resolve) => {
            console.log('selectFile called');

            // Try CEP dialog first
            if (typeof window.cep !== 'undefined' && window.cep.fs && window.cep.fs.showOpenDialog) {
                try {
                    const result = window.cep.fs.showOpenDialog(
                        false,  // allowMultipleSelection
                        false,  // chooseDirectory
                        'Select Project File',
                        '',
                        ['prproj']  // file extensions
                    );

                    if (result && result.err === 0 && result.data && result.data.length > 0) {
                        resolve(result.data[0]);
                        return;
                    }
                } catch (e) {
                    console.error('File dialog error:', e);
                }
            }

            // Try ExtendScript
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript(
                        '(function(){ var f = File.openDialog("Select Project", "*.prproj"); return f ? f.fsName : ""; })()',
                        (result) => {
                            if (result && result !== '' && result !== 'null') {
                                resolve(result);
                            } else {
                                this._showNativeFilePicker(resolve, false, extensions);
                            }
                        }
                    );
                    return;
                } catch (e) {
                    console.log('evalScript failed:', e);
                }
            }

            // HTML5 fallback
            this._showNativeFilePicker(resolve, false, extensions);
        });
    },

    // =============================================
    // SELECT MULTIPLE FILES
    // =============================================
    selectMultipleFiles() {
        return new Promise((resolve) => {
            console.log('selectMultipleFiles called');

            // Try CEP dialog first
            if (typeof window.cep !== 'undefined' && window.cep.fs && window.cep.fs.showOpenDialog) {
                try {
                    const result = window.cep.fs.showOpenDialog(
                        true,   // allowMultipleSelection
                        false,  // chooseDirectory
                        'Select Files to Push',
                        '',
                        []  // all file types
                    );

                    if (result && result.err === 0 && result.data && result.data.length > 0) {
                        resolve(result.data);
                        return;
                    }
                } catch (e) {
                    console.error('Multi-file dialog error:', e);
                }
            }

            // HTML5 fallback with multiple selection
            this._showNativeMultiFilePicker(resolve);
        });
    },

    // Native HTML5 file/folder picker
    _showNativeFilePicker(resolve, isFolder, extensions = '') {
        const input = document.createElement('input');
        input.type = 'file';
        input.style.position = 'fixed';
        input.style.top = '-1000px';
        input.style.left = '-1000px';

        if (isFolder) {
            input.webkitdirectory = true;
            input.directory = true;
        } else if (extensions) {
            input.accept = extensions;
        }

        document.body.appendChild(input);

        input.onchange = (e) => {
            console.log('File input changed:', e.target.files);
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                let result = '';

                if (file.path) {
                    // Node/Electron environment
                    result = isFolder ? this.getDirname(file.path) : file.path;
                } else if (isFolder && file.webkitRelativePath) {
                    // Browser - need to prompt for full path
                    const folderName = file.webkitRelativePath.split('/')[0];
                    result = prompt(
                        `Selected folder: "${folderName}"\n\nEnter the full path to this folder:`,
                        'G:\\My Drive\\' + folderName
                    );
                } else {
                    result = file.name;
                }

                document.body.removeChild(input);
                resolve(result || null);
            } else {
                document.body.removeChild(input);
                resolve(null);
            }
        };

        // Trigger click
        setTimeout(() => input.click(), 100);
    },

    _showNativeMultiFilePicker(resolve) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.position = 'fixed';
        input.style.top = '-1000px';

        document.body.appendChild(input);

        input.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const files = Array.from(e.target.files).map(f => ({
                    name: f.name,
                    path: f.path || f.name,
                    size: f.size,
                    type: f.type
                }));
                document.body.removeChild(input);
                resolve(files);
            } else {
                document.body.removeChild(input);
                resolve([]);
            }
        };

        setTimeout(() => input.click(), 100);
    },

    // =============================================
    // FILE SYSTEM OPERATIONS
    // =============================================

    // Get all files in a folder (for project folder scanning)
    getFilesInFolder(folderPath, recursive = false) {
        if (!this.fs || !folderPath) return [];

        try {
            const files = [];
            const items = this.fs.readdirSync(folderPath);

            for (const item of items) {
                const fullPath = this.path.join(folderPath, item);
                const stats = this.fs.statSync(fullPath);

                if (stats.isFile()) {
                    files.push({
                        name: item,
                        path: fullPath,
                        size: stats.size,
                        modified: stats.mtime,
                        extension: this.path.extname(item).toLowerCase()
                    });
                } else if (stats.isDirectory() && recursive) {
                    // Recursively get files from subdirectories
                    const subFiles = this.getFilesInFolder(fullPath, true);
                    files.push(...subFiles);
                }
            }

            return files;
        } catch (error) {
            console.error('Error reading folder:', error);
            return [];
        }
    },

    // Get project files only
    getProjectFiles(folderPath) {
        return this.getFilesInFolder(folderPath).filter(f =>
            f.extension === '.prproj'
        );
    },

    // Get media files (video, audio, images)
    getMediaFiles(folderPath) {
        const mediaExtensions = [
            '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.m4v', // video
            '.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', // audio
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.psd' // images
        ];

        return this.getFilesInFolder(folderPath, true).filter(f =>
            mediaExtensions.includes(f.extension)
        );
    },

    copyFile(source, destination) {
        if (!this.fs) return false;

        try {
            this.fs.copyFileSync(source, destination);
            return true;
        } catch (error) {
            console.error('Error copying file:', error);
            return false;
        }
    },

    fileExists(filePath) {
        if (!this.fs) return false;
        return this.fs.existsSync(filePath);
    },

    getBasename(filePath) {
        if (!filePath) return '';
        if (this.path) return this.path.basename(filePath);
        return filePath.split(/[/\\]/).pop() || filePath;
    },

    getDirname(filePath) {
        if (!filePath) return '';
        if (this.path) return this.path.dirname(filePath);
        const parts = filePath.split(/[/\\]/);
        parts.pop();
        return parts.join('\\') || parts.join('/');
    },

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    },

    // =============================================
    // TIMELINE & PROJECT SCANNING (via ExtendScript)
    // =============================================

    // Get all files from the timeline
    getTimelineFiles() {
        return new Promise((resolve) => {
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript('getTimelineFiles()', (result) => {
                        console.log('getTimelineFiles result:', result);
                        if (result && result !== 'undefined') {
                            try {
                                const parsed = JSON.parse(result);
                                resolve(parsed.files || []);
                                return;
                            } catch (e) {
                                console.log('Parse error:', e);
                            }
                        }
                        resolve([]);
                    });
                } catch (e) {
                    console.error('evalScript error:', e);
                    resolve([]);
                }
            } else {
                resolve([]);
            }
        });
    },

    // Get all media files from the project panel
    getProjectMediaFiles() {
        return new Promise((resolve) => {
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript('getProjectMediaFiles()', (result) => {
                        console.log('getProjectMediaFiles result:', result);
                        if (result && result !== 'undefined') {
                            try {
                                const parsed = JSON.parse(result);
                                resolve(parsed.files || []);
                                return;
                            } catch (e) {
                                console.log('Parse error:', e);
                            }
                        }
                        resolve([]);
                    });
                } catch (e) {
                    console.error('evalScript error:', e);
                    resolve([]);
                }
            } else {
                resolve([]);
            }
        });
    },

    // Get footage files from an After Effects project via BridgeTalk
    getAEFootageFiles(aepPath, compNames) {
        return new Promise((resolve) => {
            if (this.csInterface) {
                try {
                    const compNamesJSON = JSON.stringify(compNames);

                    console.log(`🎬 Scanning AE project: ${aepPath}`);
                    console.log(`🎬 Compositions to scan: ${compNames.join(', ')}`);

                    this.csInterface.evalScript(
                        `getAEFootageFiles(${JsxEscape.jsxString(aepPath)}, ${JsxEscape.jsxString(compNamesJSON)})`,
                        (result) => {
                            console.log('getAEFootageFiles result:', result);
                            if (result && result !== 'undefined') {
                                try {
                                    const parsed = JSON.parse(result);
                                    if (parsed.error) {
                                        console.error('AE scan error:', parsed.error);
                                    }
                                    resolve(parsed.files || []);
                                    return;
                                } catch (e) {
                                    console.log('Parse error:', e);
                                }
                            }
                            resolve([]);
                        }
                    );
                } catch (e) {
                    console.error('evalScript error:', e);
                    resolve([]);
                }
            } else {
                resolve([]);
            }
        });
    },

    // Relink footage inside an After Effects project to new local paths.
    // mappings: [{ oldPath, newPath }]
    relinkAeFootage(aepPath, mappings) {
        return new Promise((resolve) => {
            if (!this.csInterface) { resolve({ error: 'CSInterface not available', relinked: 0, failed: 0 }); return; }
            try {
                const mappingJson = JSON.stringify((mappings || []).map(m => ({ o: m.oldPath, n: m.newPath })));
                this.csInterface.evalScript(`relinkAeFootage(${JsxEscape.jsxString(aepPath)}, ${JsxEscape.jsxString(mappingJson)})`, (result) => {
                    try { resolve(JSON.parse(result)); }
                    catch (e) { resolve({ error: 'Parse error: ' + (result || 'empty'), relinked: 0, failed: 0 }); }
                });
            } catch (e) {
                resolve({ error: e.message, relinked: 0, failed: 0 });
            }
        });
    },

    // Save the currently open Premiere project (so push never sends a stale .prproj)
    saveProject() {
        return new Promise((resolve) => {
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript('saveProject()', (result) => {
                        try { resolve(JSON.parse(result)); }
                        catch (e) { resolve({ success: false, error: 'Parse error' }); }
                    });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            } else {
                resolve({ success: false, error: 'CSInterface not available' });
            }
        });
    },

    openProject(projectPath) {
        return new Promise((resolve, reject) => {
            if (this.csInterface) {
                try {
                    this.csInterface.evalScript(`openProject(${JsxEscape.jsxString(projectPath)})`, (result) => {
                        console.log('openProject result:', result);
                        if (result && result !== 'undefined') {
                            try {
                                const parsed = JSON.parse(result);
                                if (parsed.success) {
                                    resolve(parsed);
                                } else {
                                    reject(new Error(parsed.error || 'Failed to open project'));
                                }
                                return;
                            } catch (e) {
                                console.log('Parse error:', e);
                                reject(e);
                            }
                        } else {
                            reject(new Error('No result from openProject'));
                        }
                    });
                } catch (e) {
                    console.error('evalScript error:', e);
                    reject(e);
                }
            } else {
                reject(new Error('CSInterface not available'));
            }
        });
    }
};

// Initialize on load
FileSystem.init();
