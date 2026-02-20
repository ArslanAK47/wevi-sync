/**
 * Download Helper - Pull projects from Google Drive with progress tracking
 *
 * Features:
 * - Progress bar with percentage
 * - Download speed calculation
 * - ETA estimation
 * - File counts (downloaded, skipped, remaining)
 * - Conflict detection
 * - Cancellation support
 */

// Global download context for cancellation
let downloadContext = null;

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format seconds to human readable time
 */
function formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

/**
 * Download a project from Drive with progress tracking and conflict detection
 * @param {string} projectName - Name of the project folder on Drive
 * @param {string} projectFolderId - Drive folder ID
 * @param {string} targetFolder - Local folder to download to (from Config.data.syncFolder)
 * @param {boolean} showProgressModal - Whether to show download progress UI
 * @param {boolean} updateInPlace - If true, download to targetFolder directly (no subdirectory)
 * @returns {Promise<{success: boolean, downloadedCount?: number, skippedCount?: number, conflicts?: Array, error?: string}>}
 */
async function downloadProjectWithProgress(projectName, projectFolderId, targetFolder, showProgressModal = true, updateInPlace = false) {
    console.log(`📥 Starting download: ${projectName} to ${targetFolder}`);
    console.log(`Update in-place: ${updateInPlace}`);

    // Show loading state immediately
    if (showProgressModal) {
        const modal = document.getElementById('modal-download-progress');
        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('download-project-name').textContent = projectName;
            document.getElementById('download-current-file').textContent = 'Loading file list from Google Drive...';

            // Show loading spinner state
            const percentEl = document.getElementById('download-percent');
            const filesCountEl = document.getElementById('download-files-count');
            const progressFill = document.getElementById('download-progress-fill');
            const speedEl = document.getElementById('download-speed');
            const etaEl = document.getElementById('download-eta');
            const downloadedCountEl = document.getElementById('download-downloaded-count');
            const skippedCountEl = document.getElementById('download-skipped-count');
            const remainingCountEl = document.getElementById('download-remaining-count');

            if (percentEl) percentEl.textContent = '...';
            if (filesCountEl) filesCountEl.textContent = 'Loading...';
            if (progressFill) {
                progressFill.style.width = '100%';
                progressFill.classList.add('loading-animation');
            }
            if (speedEl) speedEl.textContent = '--';
            if (etaEl) etaEl.textContent = 'Fetching files...';
            if (downloadedCountEl) downloadedCountEl.textContent = '-- downloaded';
            if (skippedCountEl) skippedCountEl.textContent = '-- skipped';
            if (remainingCountEl) remainingCountEl.textContent = '-- remaining';

            // Clear file list
            const fileList = document.getElementById('download-file-list');
            if (fileList) fileList.innerHTML = '<div class="loading-message">Connecting to Google Drive...</div>';
        }
    }

    // Smart path: if updateInPlace, use targetFolder directly; otherwise create subdirectory
    const projectPath = updateInPlace ? targetFolder : `${targetFolder}\\${projectName}`;
    console.log(`Project path: ${projectPath}`);

    // Create project folder if it doesn't exist (only for new projects)
    if (!updateInPlace) {
        const statResult = cep.fs.stat(projectPath);
        const folderExists = (statResult.err === 0 && statResult.data.isDirectory());
        if (!folderExists) {
            console.log(`Creating folder: ${projectPath}`);
            cep.fs.makedir(projectPath);
        }
    }

    // Get list of files in the Drive folder
    let driveFiles;
    try {
        if (showProgressModal) {
            document.getElementById('download-current-file').textContent = 'Fetching file list from Google Drive...';
        }

        driveFiles = await GoogleDrive.listFilesInFolder(projectFolderId);
        console.log(`Found ${driveFiles.length} files on Drive`);

        // Remove loading animation
        if (showProgressModal) {
            const progressFill = document.getElementById('download-progress-fill');
            if (progressFill) {
                progressFill.classList.remove('loading-animation');
                progressFill.style.width = '0%';
            }
            const fileList = document.getElementById('download-file-list');
            if (fileList) fileList.innerHTML = '';
        }
    } catch (error) {
        console.error('Error listing Drive files:', error);
        if (showProgressModal) {
            document.getElementById('download-current-file').textContent = `❌ Error: ${error.message}`;
            const progressFill = document.getElementById('download-progress-fill');
            if (progressFill) progressFill.classList.remove('loading-animation');
        }
        return { success: false, error: error.message };
    }

    if (driveFiles.length === 0) {
        if (showProgressModal) {
            document.getElementById('download-current-file').textContent = '❌ No files found in project folder';
        }
        return { success: false, error: 'No files found in project folder' };
    }

    // Calculate total size
    let totalSize = 0;
    for (const file of driveFiles) {
        totalSize += parseInt(file.size) || 0;
    }

    const downloadState = {
        totalFiles: driveFiles.length,
        completedFiles: 0,
        downloadedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        conflicts: [],
        cancelled: false,
        totalBytes: totalSize,
        downloadedBytes: 0,
        startTime: Date.now()
    };

    // Expose globally for cancel button
    downloadContext = downloadState;

    // UI update function
    function updateUI() {
        if (!showProgressModal) return;

        const elapsed = (Date.now() - downloadState.startTime) / 1000;
        const safeElapsed = Math.max(elapsed, 0.1);

        // Calculate progress
        const percent = Math.round((downloadState.completedFiles / downloadState.totalFiles) * 100);
        const remaining = downloadState.totalFiles - downloadState.completedFiles;

        // Calculate speed (files per second and bytes per second)
        const filesPerSecond = downloadState.downloadedFiles / safeElapsed;
        const bytesPerSecond = downloadState.downloadedBytes / safeElapsed;

        // Calculate ETA
        let eta = 0;
        if (filesPerSecond > 0 && remaining > 0) {
            eta = remaining / filesPerSecond;
        }

        // Update UI elements
        const percentEl = document.getElementById('download-percent');
        const filesCountEl = document.getElementById('download-files-count');
        const progressFill = document.getElementById('download-progress-fill');
        const speedEl = document.getElementById('download-speed');
        const etaEl = document.getElementById('download-eta');
        const downloadedCountEl = document.getElementById('download-downloaded-count');
        const skippedCountEl = document.getElementById('download-skipped-count');
        const remainingCountEl = document.getElementById('download-remaining-count');

        if (percentEl) percentEl.textContent = `${percent}%`;
        if (filesCountEl) filesCountEl.textContent = `${downloadState.completedFiles} / ${downloadState.totalFiles} files`;
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (speedEl) speedEl.textContent = `${formatBytes(bytesPerSecond)}/s`;
        if (etaEl) etaEl.textContent = eta > 0 ? formatTime(eta) + ' remaining' : 'Calculating...';
        if (downloadedCountEl) downloadedCountEl.textContent = `${downloadState.downloadedFiles} downloaded`;
        if (skippedCountEl) skippedCountEl.textContent = `${downloadState.skippedFiles} skipped`;
        if (remainingCountEl) remainingCountEl.textContent = `${remaining} remaining`;
    }

    // Initialize progress UI (modal already shown during loading)
    if (showProgressModal) {
        updateUI();
    }

    const downloadedFiles = [];

    // Download each file
    for (let i = 0; i < driveFiles.length; i++) {
        const driveFile = driveFiles[i];
        const targetPath = `${projectPath}\\${driveFile.name}`;
        const fileSize = parseInt(driveFile.size) || 0;

        console.log(`Checking file: ${driveFile.name}`);

        // Check for cancellation
        if (downloadState.cancelled) {
            console.log('Download cancelled by user');
            break;
        }

        // Update current file display
        if (showProgressModal) {
            document.getElementById('download-current-file').textContent = `Checking ${driveFile.name}...`;
        }

        // Check if file exists locally using CEP API
        const statResult = cep.fs.stat(targetPath);
        const localExists = (statResult.err === 0);

        if (localExists) {
            // File exists - check for conflicts using file size comparison
            console.log(`  File exists locally, checking for conflicts...`);

            // Get local file stats using Node.js fs if available (more reliable)
            let localSize = 0;
            let localMtime = null;

            try {
                if (typeof require !== 'undefined') {
                    const fs = require('fs');
                    if (fs.existsSync(targetPath)) {
                        const stats = fs.statSync(targetPath);
                        localSize = stats.size;
                        localMtime = stats.mtime;
                        console.log(`  Node.js Stat: size=${localSize}, mtime=${localMtime}`);
                    }
                } else {
                    // Fallback to CEP
                    const localStat = cep.fs.stat(targetPath);
                    if (localStat.err === 0) {
                        console.log(`  CEP Stat result:`, localStat);
                        localSize = (localStat.data && localStat.data.size) || 0;
                    }
                }
            } catch (e) {
                console.warn('Stat check failed:', e);
            }

            const driveSize = parseInt(driveFile.size) || 0;

            console.log(`  Local size: ${localSize}`);
            console.log(`  Drive size: ${driveSize}`);

            if (localSize === driveSize) {
                // Files are same size - assume identical, skip
                console.log(`  ✓ Same size - Skipping ${driveFile.name}`);
                downloadState.skippedFiles++;
                downloadState.completedFiles++;
                downloadState.downloadedBytes += fileSize; // Count as "processed"

                // Add to file list UI
                addFileToList(driveFile.name, 'skipped', showProgressModal);
                updateUI();
                continue;
            } else {
                // Different size - conflict detected
                console.warn(`  ⚠️ Size mismatch detected: ${driveFile.name}`);
                downloadState.conflicts.push({
                    name: driveFile.name,
                    localPath: targetPath,
                    driveFile: driveFile,
                    localSize: localSize,
                    driveSize: driveSize
                });
                downloadState.completedFiles++;

                // Add to file list UI
                addFileToList(driveFile.name, 'conflict', showProgressModal);
                updateUI();
                continue;
            }
        }

        // Download the file
        try {
            if (showProgressModal) {
                document.getElementById('download-current-file').textContent = `Downloading ${driveFile.name}...`;
                addFileToList(driveFile.name, 'downloading', showProgressModal);
            }

            console.log(`  ⬇️ Downloading ${driveFile.name}...`);
            const fileContent = await GoogleDrive.downloadFile(driveFile.id);

            // Check for cancellation after download
            if (downloadState.cancelled) {
                console.log('Download cancelled by user');
                break;
            }

            // Convert Uint8Array to Base64 for CEP file system
            let binary = '';
            const len = fileContent.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(fileContent[i]);
            }
            const base64Content = btoa(binary);

            // Write to disk using CEP API
            const writeResult = cep.fs.writeFile(targetPath, base64Content, cep.encoding.Base64);
            if (writeResult.err !== 0) {
                console.error(`  ❌ Failed to write ${driveFile.name}: Error ${writeResult.err}`);
                downloadState.failedFiles++;
                updateFileStatus(driveFile.name, 'error', showProgressModal);
            } else {
                console.log(`  ✅ Downloaded ${driveFile.name}`);
                downloadedFiles.push({ name: driveFile.name, path: targetPath, size: fileSize });
                downloadState.downloadedFiles++;
                downloadState.downloadedBytes += fileSize;
                updateFileStatus(driveFile.name, 'complete', showProgressModal);
            }

            downloadState.completedFiles++;
            updateUI();
        } catch (error) {
            console.error(`  ❌ Error downloading ${driveFile.name}:`, error);
            downloadState.failedFiles++;
            downloadState.completedFiles++;
            updateFileStatus(driveFile.name, 'error', showProgressModal);
            updateUI();
        }
    }

    // Final UI update
    if (showProgressModal) {
        const currentFileEl = document.getElementById('download-current-file');
        if (currentFileEl) {
            if (downloadState.cancelled) {
                currentFileEl.textContent = '🚫 Download cancelled';
            } else {
                currentFileEl.textContent = `✅ Download complete!`;
            }
        }

        // Update ETA to show completion
        const etaEl = document.getElementById('download-eta');
        if (etaEl) {
            const elapsed = (Date.now() - downloadState.startTime) / 1000;
            etaEl.textContent = `Completed in ${formatTime(elapsed)}`;
        }

        // Hide modal after delay
        const modal = document.getElementById('modal-download-progress');
        if (modal) {
            setTimeout(() => modal.classList.add('hidden'), 3000);
        }
    }

    console.log(`✅ Download complete: ${downloadState.downloadedFiles} downloaded, ${downloadState.skippedFiles} skipped, ${downloadState.conflicts.length} conflicts`);

    return {
        success: true,
        downloadedCount: downloadedFiles.length,
        skippedCount: downloadState.skippedFiles,
        failedCount: downloadState.failedFiles,
        conflicts: downloadState.conflicts,
        projectPath: projectPath
    };
}

/**
 * Add a file entry to the download file list UI
 */
function addFileToList(fileName, status, showProgressModal) {
    if (!showProgressModal) return;

    const fileList = document.getElementById('download-file-list');
    if (!fileList) return;

    const safeId = fileName.replace(/[^a-zA-Z0-9]/g, '_');

    // Check if already exists
    let item = document.getElementById(`download-item-${safeId}`);
    if (!item) {
        item = document.createElement('div');
        item.className = 'upload-file-item';
        item.id = `download-item-${safeId}`;
        item.innerHTML = `
            <span class="file-item-name">${fileName}</span>
            <span class="file-item-status">Queued</span>
        `;
        fileList.appendChild(item);
    }

    updateFileStatus(fileName, status, showProgressModal);
}

/**
 * Update file status in the list
 */
function updateFileStatus(fileName, status, showProgressModal) {
    if (!showProgressModal) return;

    const safeId = fileName.replace(/[^a-zA-Z0-9]/g, '_');
    const item = document.getElementById(`download-item-${safeId}`);
    if (!item) return;

    const statusEl = item.querySelector('.file-item-status');
    if (!statusEl) return;

    const statusMap = {
        'queued': { text: 'Queued', class: '' },
        'downloading': { text: '⬇️ Downloading...', class: 'uploading' },
        'complete': { text: '✅ Done', class: 'complete' },
        'skipped': { text: '⏭️ Skipped', class: 'skipped' },
        'conflict': { text: '⚠️ Conflict', class: 'warning' },
        'error': { text: '❌ Failed', class: 'error' }
    };

    const statusInfo = statusMap[status] || statusMap['queued'];
    statusEl.textContent = statusInfo.text;
    item.className = `upload-file-item ${statusInfo.class}`;
}

/**
 * Resolve conflicts for a pull operation
 * @param {Array} conflicts - Array of conflict objects from downloadProjectWithProgress
 * @param {string} strategy - 'drive' (use Drive version), 'local' (keep local), 'ask' (show modal)
 */
async function resolveConflicts(conflicts, strategy = 'ask') {
    if (conflicts.length === 0) return { resolved: 0 };

    if (strategy === 'ask') {
        // Show conflict modal and let user decide
        return await showConflictModal(conflicts);
    }

    let resolved = 0;
    for (const conflict of conflicts) {
        if (strategy === 'drive') {
            // Download and overwrite
            const fileContent = await GoogleDrive.downloadFile(conflict.driveFile.id);
            await FileSystem.writeFile(conflict.localPath, fileContent);
            console.log(`Resolved conflict: ${conflict.name} (used Drive version)`);
            resolved++;
        } else if (strategy === 'local') {
            // Keep local - do nothing
            console.log(`Resolved conflict: ${conflict.name} (kept local version)`);
            resolved++;
        }
    }

    return { resolved };
}

/**
 * Calculate MD5 hash of file content
 */
async function calculateMD5(data) {
    // Use the same MD5 function from upload-xhr.js
    if (typeof SparkMD5 !== 'undefined') {
        const spark = new SparkMD5.ArrayBuffer();
        spark.append(data);
        return spark.end();
    }

    // Fallback: basic hash (not MD5, but better than nothing)
    let hash = 0;
    for (let i = 0; i < data.byteLength; i++) {
        hash = ((hash << 5) - hash) + data[i];
        hash = hash & hash;
    }
    return hash.toString(16);
}
