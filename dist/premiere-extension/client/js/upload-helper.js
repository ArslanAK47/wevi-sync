// Sequential Upload System with Progress Tracking
// Uploads files one by one to avoid race conditions

async function uploadProjectWithConcurrency(projectData, showProgressModal = true) {
    const MAX_PARALLEL_UPLOADS = 3;
    const pathModule = (typeof require !== 'undefined') ? require('path') : null;
    const fs = (typeof require !== 'undefined') ? require('fs') : null;

    function toForwardSlash(value) {
        return (value || '').replace(/\\/g, '/');
    }

    function trimLeadingSlashes(value) {
        return (value || '').replace(/^[/\\]+/, '');
    }

    function sanitizeRelativePath(value) {
        return trimLeadingSlashes(toForwardSlash(value).replace(/\/+/g, '/'));
    }

    function buildDriveRelativePath(file, projectRootNormalized) {
        if (!pathModule || !file.path) return file.name;
        if (file.type === 'project') return pathModule.basename(file.path);

        const absolute = pathModule.resolve(file.path);
        const normalizedAbsolute = toForwardSlash(absolute).toLowerCase();
        const normalizedRoot = (projectRootNormalized || '').toLowerCase();

        // Keep project-internal files in a clean relative tree.
        if (normalizedRoot && (normalizedAbsolute === normalizedRoot || normalizedAbsolute.startsWith(normalizedRoot + '/'))) {
            const rel = pathModule.relative(projectData.baseFolder || '', absolute);
            return sanitizeRelativePath(rel);
        }

        // For external files, preserve path uniqueness to avoid filename collisions.
        const driveMatch = absolute.match(/^([a-zA-Z]):[\\/]/);
        const drivePrefix = driveMatch ? `external_${driveMatch[1].toLowerCase()}` : 'external';
        const withoutDrive = absolute.replace(/^[a-zA-Z]:[\\/]/, '');
        return sanitizeRelativePath(`${drivePrefix}/${withoutDrive}`);
    }

    function getMimeTypeFromName(fileName) {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        if (ext === 'mov') return 'video/quicktime';
        if (ext === 'mp4') return 'video/mp4';
        if (ext === 'avi') return 'video/x-msvideo';
        if (ext === 'mxf') return 'application/mxf';
        if (ext === 'wav') return 'audio/wav';
        if (ext === 'mp3') return 'audio/mpeg';
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
        if (ext === 'png') return 'image/png';
        return 'application/octet-stream';
    }

    // Prepare files to upload
    const allFilesToUpload = [];
    allFilesToUpload.push({
        name: projectData.name,
        path: projectData.path,
        type: 'project'
    });
    if (projectData.mediaFiles && projectData.mediaFiles.length > 0) {
        allFilesToUpload.push(...projectData.mediaFiles);
    }

    const projectRoot = pathModule && projectData.path ? pathModule.dirname(projectData.path) : '';
    const normalizedProjectRoot = toForwardSlash(projectRoot);
    projectData.baseFolder = projectRoot;

    allFilesToUpload.forEach((file, index) => {
        file.uploadKey = `${index}:${file.path || file.name}`;
        file.driveRelativePath = buildDriveRelativePath(file, normalizedProjectRoot) || file.name;
        file.driveFileName = sanitizeRelativePath(file.driveRelativePath).split('/').pop() || file.name;
    });

    const totalFiles = allFilesToUpload.length;
    let completedFiles = 0;
    let totalBytesTransferred = 0;
    let uploadedFilesCount = 0;
    let skippedFilesCount = 0;
    let failedFilesCount = 0;
    let cancelledFilesCount = 0;
    const startTime = Date.now();

    // Track upload state
    const uploadState = {
        fileItems: {},
        fileStatus: {}, // 'queued', 'uploading', 'complete', 'skipped', 'cancelled', 'error'
        totalSize: 0,
        uploadedSize: 0,
        isUploading: true, // Flag to prevent modal closing
        currentFileName: null
    };

    // Cancellation context
    const uploadContext = {
        cancelled: false,
        currentXhr: null,
        currentAbortController: null,
        activeXhrs: {},
        cancelledFiles: new Set() // Track individually cancelled files by uploadKey
    };

    // Show progress modal
    if (showProgressModal) {
        const modal = document.getElementById('modal-upload-progress');
        const uploadIndicator = document.getElementById('upload-indicator');

        modal.classList.remove('hidden');
        if (uploadIndicator) uploadIndicator.classList.add('hidden');

        // Prevent closing by background click while uploading
        modal.addEventListener('click', function modalBackdropHandler(e) {
            if (e.target === modal) {
                if (uploadState.isUploading) {
                    e.stopPropagation();
                    e.preventDefault();
                    // Show floating indicator instead
                    modal.classList.add('hidden');
                    if (uploadIndicator) uploadIndicator.classList.remove('hidden');
                } else {
                    modal.classList.add('hidden');
                }
            }
        });

        // Floating button click - reopen modal
        if (uploadIndicator) {
            uploadIndicator.onclick = () => {
                modal.classList.remove('hidden');
                uploadIndicator.classList.add('hidden');
            };
        }

        // Setup Cancel All Button
        const cancelBtn = document.getElementById('btn-cancel-upload');
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                if (confirm('Cancel ALL uploads?')) {
                    console.warn('🛑 Cancelling all uploads...');
                    uploadContext.cancelled = true;
                    if (uploadContext.currentXhr) {
                        uploadContext.currentXhr.abort();
                    }
                    if (uploadContext.currentAbortController) {
                        uploadContext.currentAbortController.abort();
                    }
                    Object.keys(uploadContext.activeXhrs).forEach((key) => {
                        try {
                            uploadContext.activeXhrs[key].abort();
                        } catch (abortErr) {
                            // Non-fatal
                        }
                    });
                    uploadState.isUploading = false;
                    modal.classList.add('hidden');
                    if (uploadIndicator) uploadIndicator.classList.add('hidden');
                }
            };
        }

        // Initialize UI
        document.getElementById('upload-percent').textContent = '0%';
        document.getElementById('upload-file-count').textContent = `0 uploaded, 0 skipped, 0 failed, ${totalFiles} remaining`;
        document.getElementById('upload-speed').textContent = '0 MB/s';
        document.getElementById('upload-eta').textContent = 'Calculating...';
        document.querySelector('.progress-fill').style.width = '0%';

        // Create file list items with Cancel buttons
        const fileList = document.getElementById('upload-file-list');
        fileList.innerHTML = '';

        allFilesToUpload.forEach(file => {
            const item = document.createElement('div');
            item.className = 'upload-file-item';
            const safeName = file.uploadKey.replace(/[^a-zA-Z0-9]/g, '_');
            item.id = `upload-item-${safeName}`;

            // Add Cancel (X) button for each file
            item.innerHTML = `
                <span class="file-item-name">${file.name}</span>
                <div class="file-item-actions" style="display: flex; align-items: center; gap: 10px;">
                    <span class="file-item-status">Queued</span>
                    <button class="btn-icon-small btn-cancel-file" style="background: none; border: none; color: #ff4444; cursor: pointer; font-size: 16px; padding: 0 5px;" title="Cancel this file">✕</button>
                </div>
            `;

            // Add listener for individual cancel
            const fileCancelBtn = item.querySelector('.btn-cancel-file');
            fileCancelBtn.onclick = (e) => {
                e.stopPropagation();
                if (uploadState.fileStatus[file.uploadKey] === 'complete' || uploadState.fileStatus[file.uploadKey] === 'skipped') return;

                console.log(`🛑 Cancelling ${file.name}`);
                uploadContext.cancelledFiles.add(file.uploadKey);
                uploadState.fileStatus[file.uploadKey] = 'cancelled';

                // Update UI immediately (greyed out or error style)
                item.style.opacity = '0.6';
                item.querySelector('.file-item-status').textContent = '🚫 Cancelled';
                fileCancelBtn.style.display = 'none';

                // If this is the currently uploading file, abort it
                if (file.uploadKey === uploadState.currentFileName && uploadContext.currentXhr) {
                    console.log('Aborting active upload...');
                    uploadContext.currentXhr.abort();
                }
                if (file.uploadKey === uploadState.currentFileName && uploadContext.currentAbortController) {
                    uploadContext.currentAbortController.abort();
                }
                if (uploadContext.activeXhrs[file.uploadKey]) {
                    try {
                        uploadContext.activeXhrs[file.uploadKey].abort();
                    } catch (e2) {
                        // Non-fatal
                    }
                }
            };

            fileList.appendChild(item);
            uploadState.fileItems[file.uploadKey] = item;
            uploadState.fileStatus[file.uploadKey] = 'queued';
        });
    }

    // Update UI function
    function updateUI() {
        if (!showProgressModal) return;

        const percent = Math.round((completedFiles / totalFiles) * 100);
        const elapsed = (Date.now() - startTime) / 1000; // seconds
        const safeElapsed = Math.max(elapsed, 1);
        const networkSpeed = totalBytesTransferred / safeElapsed / 1024 / 1024; // MB/s
        const filesPerMinute = (completedFiles / safeElapsed) * 60;
        const remaining = totalFiles - completedFiles;
        const eta = (remaining > 0 && completedFiles > 0) ? Math.ceil((elapsed / completedFiles) * remaining) : 0;

        document.getElementById('upload-percent').textContent = `${percent}%`;
        document.getElementById('upload-file-count').textContent =
            `${uploadedFilesCount} uploaded, ${skippedFilesCount} skipped, ${failedFilesCount} failed, ${remaining} remaining`;
        document.getElementById('upload-speed').textContent = `${networkSpeed.toFixed(2)} MB/s • ${filesPerMinute.toFixed(1)} files/min`;
        document.querySelector('.progress-fill').style.width = `${percent}%`;

        if (eta > 0) {
            const minutes = Math.floor(eta / 60);
            const seconds = eta % 60;
            document.getElementById('upload-eta').textContent =
                minutes > 0 ? `${minutes}m ${seconds}s remaining` : `${seconds}s remaining`;
        } else {
            document.getElementById('upload-eta').textContent = 'Almost done...';
        }
    }

    // Create project folder ONCE before starting uploads
    console.log('📁 Creating project folder...');
    const rootFolderId = GoogleDriveConfig.teamProjectsFolderId;
    const projectName = projectData.name.replace('.prproj', '');

    // Check cancellation
    if (uploadContext.cancelled) return { success: false, cancelled: true };

    const projectFolderId = await GoogleDrive.getOrCreateFolder(projectName, rootFolderId);
    console.log(`✅ Project folder ready: ${projectFolderId}`);

    // Share project folder with team (drive.file scope workaround)
    await GoogleDrive.shareWithTeam(projectFolderId);
    // Also share the parent "Projects" folder so team can browse
    await GoogleDrive.shareWithTeam(rootFolderId);

    // Upload files sequentially (one at a time)
    console.log(`🚀 Starting sequential upload of ${totalFiles} files...`);
    const uploadedFiles = [];
    const reportEntries = [];
    const folderCache = { '': projectFolderId };
    const folderPromiseCache = {};

    async function getFolderForFile(file) {
        const relPath = sanitizeRelativePath(file.driveRelativePath || file.driveFileName || file.name);
        const parts = relPath.split('/').filter(Boolean);
        const folderParts = parts.slice(0, Math.max(0, parts.length - 1));
        if (folderParts.length === 0) return projectFolderId;

        let currentParentId = projectFolderId;
        let currentPathKey = '';
        for (const part of folderParts) {
            currentPathKey = currentPathKey ? `${currentPathKey}/${part}` : part;
            if (!folderCache[currentPathKey]) {
                if (!folderPromiseCache[currentPathKey]) {
                    folderPromiseCache[currentPathKey] = GoogleDrive.getOrCreateFolder(part, currentParentId);
                }
                folderCache[currentPathKey] = await folderPromiseCache[currentPathKey];
            }
            currentParentId = folderCache[currentPathKey];
        }
        return currentParentId;
    }

    async function processSingleFile(file) {
        // Global cancellation check
        if (uploadContext.cancelled) {
            return;
        }

        // Individual cancellation check
        if (uploadContext.cancelledFiles.has(file.uploadKey)) {
            console.log(`Skipping cancelled file: ${file.name}`);
            cancelledFilesCount++;
            completedFiles++;
            reportEntries.push({
                name: file.name,
                drivePath: file.driveRelativePath || file.driveFileName || file.name,
                status: 'cancelled',
                reason: 'Cancelled by user before upload started'
            });
            updateUI();
            return;
        }

        const item = uploadState.fileItems[file.uploadKey];
        uploadState.currentFileName = file.uploadKey;
        uploadState.fileStatus[file.uploadKey] = 'uploading';

        try {
            // Update UI: uploading
            if (item) {
                item.className = 'upload-file-item uploading';
                item.querySelector('.file-item-status').textContent = 'Uploading...';
            }
            if (showProgressModal) {
                document.getElementById('upload-current-file').textContent = `Uploading ${file.name}...`;
            }

            if (!fs || !pathModule) {
                throw new Error('Node.js file APIs are not available in this environment.');
            }
            if (!file.path || !fs.existsSync(file.path)) {
                throw new Error(`File not found: ${file.path}`);
            }

            // Get actual file size from disk first
            const stats = fs.statSync(file.path);
            const actualFileSize = stats.size;
            let uploadedBytes = 0;
            const mimeType = getMimeTypeFromName(file.driveFileName || file.name);
            const targetFolderId = await getFolderForFile(file);

            // Upload to Google Drive with progress tracking
            const result = await uploadFileWithProgress(
                file.driveFileName || file.name,
                { filePath: file.path, size: actualFileSize },
                mimeType,
                targetFolderId,
                (loaded, total) => {
                    // Real-time progress callback
                    uploadedBytes = loaded;
                    const percent = Math.round((loaded / total) * 100);

                    // Update individual file status
                    if (item) {
                        item.querySelector('.file-item-status').textContent = `${percent}%`;
                    }

                    // Update overall progress
                    const elapsed = (Date.now() - startTime) / 1000;
                    const safeElapsed = Math.max(elapsed, 1);
                    const totalUploadedNow = totalBytesTransferred + loaded;
                    const speed = totalUploadedNow / safeElapsed / 1024 / 1024;
                    const filesPerMinuteNow = (Math.max(0, completedFiles) / safeElapsed) * 60;

                    if (showProgressModal) {
                        document.getElementById('upload-speed').textContent = `${speed.toFixed(2)} MB/s • ${filesPerMinuteNow.toFixed(1)} files/min`;

                        // Update ETA based on current speed
                        const remaining = totalFiles - completedFiles;
                        if (speed > 0 && remaining > 0) {
                            const avgFileSize = totalUploadedNow / (completedFiles + (loaded / total));
                            const remainingBytes = avgFileSize * remaining;
                            const etaSeconds = Math.ceil(remainingBytes / (speed * 1024 * 1024));
                            const minutes = Math.floor(etaSeconds / 60);
                            const seconds = etaSeconds % 60;
                            document.getElementById('upload-eta').textContent =
                                minutes > 0 ? `${minutes}m ${seconds}s remaining` : `${seconds}s remaining`;
                        }
                    }
                },
                actualFileSize,
                {
                    ...uploadContext,
                    registerXhr: (xhr) => {
                        uploadContext.activeXhrs[file.uploadKey] = xhr;
                    }
                } // Pass cancellation context
            );

            // Handle Response (might be object {id, skipped} or just id if I messed up)
            // Normalized result:
            const fileId = result.id || result;
            const wasSkipped = result.skipped === true;
            const skipReason = result.reason || 'Skipped by upload engine';

            // Update progress
            completedFiles++;
            if (wasSkipped) {
                skippedFilesCount++;
            } else {
                uploadedFilesCount++;
                totalBytesTransferred += actualFileSize;
            }

            // Update UI: complete or skipped
            if (item) {
                item.className = 'upload-file-item complete';
                const statusText = wasSkipped ? '⏭️ Skipped' : '✓ Complete';
                item.querySelector('.file-item-status').textContent = statusText;
                item.querySelector('.file-item-status').classList.add('success');
                // Hide cancel button
                const cancelBtn = item.querySelector('.btn-cancel-file');
                if (cancelBtn) cancelBtn.style.display = 'none';

                uploadState.fileStatus[file.uploadKey] = wasSkipped ? 'skipped' : 'complete';
            }

            if (wasSkipped) {
                console.log(`  ⏭️ Skipped ${file.name}`);
                reportEntries.push({
                    name: file.name,
                    drivePath: file.driveRelativePath || file.driveFileName || file.name,
                    status: 'skipped',
                    reason: skipReason
                });
            } else {
                console.log(`  ✅ Uploaded ${file.name} (ID: ${fileId})`);
                reportEntries.push({
                    name: file.name,
                    drivePath: file.driveRelativePath || file.driveFileName || file.name,
                    status: 'uploaded',
                    reason: 'Uploaded successfully'
                });
            }

            updateUI();

            // Add to uploaded files list
            if (!wasSkipped) {
                uploadedFiles.push({
                    name: file.name,
                    driveName: file.driveFileName || file.name,
                    drivePath: file.driveRelativePath || file.driveFileName || file.name,
                    path: file.path,
                    driveId: fileId,
                    size: actualFileSize
                });
            }
            delete uploadContext.activeXhrs[file.uploadKey];

        } catch (error) {
            // Check if cancelled (Global or Individual)
            if (uploadContext.cancelled || uploadContext.cancelledFiles.has(file.uploadKey)) {
                console.warn(`🛑 Upload of ${file.name} cancelled`);
                if (item) {
                    item.className = 'upload-file-item error';
                    item.querySelector('.file-item-status').textContent = '🚫 Cancelled';
                    const cancelBtn = item.querySelector('.btn-cancel-file');
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    uploadState.fileStatus[file.uploadKey] = 'cancelled';
                }
                cancelledFilesCount++;
                completedFiles++;
                reportEntries.push({
                    name: file.name,
                    drivePath: file.driveRelativePath || file.driveFileName || file.name,
                    status: 'cancelled',
                    reason: 'Cancelled during upload'
                });
                updateUI();

                // If global cancel, break loop
                if (uploadContext.cancelled) return;
                // If individual cancel, just continue to next file
                delete uploadContext.activeXhrs[file.uploadKey];
                return;
            }

            console.error(`❌ Error uploading ${file.name}:`, error);

            // Update UI: error
            if (item) {
                item.className = 'upload-file-item error';
                item.querySelector('.file-item-status').textContent = '✗ Failed';
                item.querySelector('.file-item-status').classList.add('error');
                uploadState.fileStatus[file.uploadKey] = 'error';
            }

            failedFilesCount++;
            completedFiles++;
            reportEntries.push({
                name: file.name,
                drivePath: file.driveRelativePath || file.driveFileName || file.name,
                status: 'failed',
                reason: (error && error.message) ? error.message : 'Unknown upload error'
            });
            updateUI();
            delete uploadContext.activeXhrs[file.uploadKey];
        }
    }

    console.log(`🚀 Starting parallel upload of ${totalFiles} files (workers: ${Math.min(MAX_PARALLEL_UPLOADS, totalFiles)})...`);
    let nextFileIndex = 0;
    async function worker() {
        while (true) {
            if (uploadContext.cancelled) return;
            const currentIndex = nextFileIndex;
            nextFileIndex++;
            if (currentIndex >= allFilesToUpload.length) return;
            await processSingleFile(allFilesToUpload[currentIndex]);
        }
    }
    const workerCount = Math.min(MAX_PARALLEL_UPLOADS, totalFiles);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    uploadState.isUploading = false; // Allow closing now

    // Hide floating indicator
    const uploadIndicator = document.getElementById('upload-indicator');
    if (uploadIndicator) uploadIndicator.classList.add('hidden');

    if (uploadContext.cancelled) {
        return { success: false, cancelled: true };
    }

    // Create manifest
    console.log('📝 Creating manifest...');
    if (showProgressModal) {
        document.getElementById('upload-current-file').textContent = 'Creating manifest...';
    }

    try {
        const manifest = {
            projectName: projectData.name,
            uploadedBy: 'OAuth User', // OAuth doesn't have fixed email
            uploadedAt: new Date().toISOString(),
            path: projectData.path,
            totalFiles: uploadedFiles.length,
            totals: {
                selected: totalFiles,
                uploaded: uploadedFilesCount,
                skipped: skippedFilesCount,
                failed: failedFilesCount,
                cancelled: cancelledFilesCount
            },
            files: uploadedFiles
        };

        // Upload manifest using the uploadFileWithProgress function
        await uploadFileWithProgress(
            'manifest.json',
            JSON.stringify(manifest, null, 2),
            'application/json',
            projectFolderId,
            null // No progress callback for manifest
        );

        console.log('✅ Manifest created successfully');
    } catch (error) {
        console.error('❌ Error creating manifest:', error);
        // Don't fail the whole upload if manifest fails
    }

    // Hide modal after 2 seconds
    if (showProgressModal) {
        setTimeout(() => {
            document.getElementById('modal-upload-progress').classList.add('hidden');
        }, 2000);
    }

    console.log(`✅ Upload complete! ${uploadedFilesCount} uploaded, ${skippedFilesCount} skipped, ${failedFilesCount} failed.`);

    return {
        success: true,
        folderId: projectFolderId,
        uploadedCount: uploadedFilesCount,
        skippedCount: skippedFilesCount,
        failedCount: failedFilesCount,
        cancelledCount: cancelledFilesCount,
        totalCount: totalFiles,
        reportEntries: reportEntries
    };
}
