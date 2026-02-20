/* ============================================
   SYNC ENGINE WITH PROPER CEP FILE DIALOGS
   ============================================ */

const SyncEngine = {
    checkInterval: null,
    lastCheck: null,

    async validateKey(apiKey, serverUrl) {
        try {
            const response = await fetch(`${serverUrl}/api/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey })
            });
            return await response.json();
        } catch (error) {
            console.error('Validation error:', error);
            return { valid: false, error: 'Cannot connect to server' };
        }
    },

    async getSyncState() {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/sync-state`);
            return await response.json();
        } catch (error) {
            console.error('Error fetching sync state:', error);
            return null;
        }
    },

    async getAvailableProjects() {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/projects`);
            return await response.json();
        } catch (error) {
            console.error('Error fetching projects:', error);
            return [];
        }
    },

    async logActivity(action, projectName = null) {
        try {
            await fetch(`${Config.data.serverUrl}/api/activity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: Config.data.apiKey,
                    action,
                    projectName
                })
            });
        } catch (error) {
            console.error('Error logging activity:', error);
        }
    },

    async registerProject(projectName, projectPath, files = []) {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/projects/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: Config.data.apiKey,
                    projectName,
                    projectPath,
                    files // Array of associated files
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Error registering project:', error);
            return { success: false, error: 'Network error' };
        }
    },

    async lockProject(projectName) {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/projects/lock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: Config.data.apiKey,
                    projectName
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Error locking project:', error);
            return { success: false, error: 'Network error' };
        }
    },

    async unlockProject(projectName) {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/projects/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: Config.data.apiKey,
                    projectName
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Error unlocking project:', error);
            return { success: false, error: 'Network error' };
        }
    },

    async getLocks() {
        try {
            const response = await fetch(`${Config.data.serverUrl}/api/projects/locks`);
            return await response.json();
        } catch (error) {
            console.error('Error fetching locks:', error);
            return [];
        }
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
                    const escapedPath = aepPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    const compNamesJSON = JSON.stringify(compNames);
                    const escapedCompNames = compNamesJSON.replace(/'/g, "\\'");

                    console.log(`🎬 Scanning AE project: ${aepPath}`);
                    console.log(`🎬 Compositions to scan: ${compNames.join(', ')}`);

                    this.csInterface.evalScript(
                        `getAEFootageFiles('${escapedPath}', '${escapedCompNames}')`,
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

    openProject(projectPath) {
        return new Promise((resolve, reject) => {
            if (this.csInterface) {
                try {
                    const escapedPath = projectPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    this.csInterface.evalScript(`openProject('${escapedPath}')`, (result) => {
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
