/* ============================================
   PREMIERE SYNC - EXTENDSCRIPT HOST
   ExtendScript for Premiere Pro API access
   ============================================ */

// This file allows the extension to interact with Premiere Pro

/**
 * Get the currently active project
 */
function getActiveProject() {
    if (app.project) {
        return JSON.stringify({
            name: app.project.name,
            path: app.project.path,
            modified: app.project.documentModified ? 'Yes' : 'No'
        });
    }
    return JSON.stringify({ error: 'No project open' });
}

/**
 * Get project file path
 */
function getProjectPath() {
    if (app.project && app.project.path) {
        return app.project.path;
    }
    return '';
}

/**
 * Check if project has unsaved changes
 */
function hasUnsavedChanges() {
    if (app.project) {
        return app.project.documentModified ? 'true' : 'false';
    }
    return 'false';
}

/**
 * Save the current project
 */
function saveProject() {
    try {
        if (app.project) {
            app.project.save();
            return JSON.stringify({ success: true });
        }
        return JSON.stringify({ success: false, error: 'No project open' });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * Close the current project
 */
function closeProject() {
    try {
        if (app.project) {
            app.project.closeDocument();
            return JSON.stringify({ success: true });
        }
        return JSON.stringify({ success: false, error: 'No project open' });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * Open a project file
 * @param {string} projectPath - Full path to the .prproj file
 */
function openProject(projectPath) {
    try {
        // Method 3: The "Save As Temp" Trick
        // 1. Check if the target project is currently open
        if (app.project && app.project.path) {
            var currentPath = app.project.path;
            if (currentPath.toLowerCase() === projectPath.toLowerCase()) {
                // 2. Save current project as a temp file
                // This switches the active project context to the temp file
                // effectively "closing" the original file reference in Premiere
                var tempPath = projectPath + ".temp.prproj";
                app.project.saveAs(tempPath);

                // 3. Now open the original (updated) project
                // Premiere views this as opening a DIFFERENT file, so it loads from disk!
                app.openDocument(projectPath);

                return JSON.stringify({ success: true, message: 'Reloaded via temp file' });
            }
        }

        // If not open, just open normally
        app.openDocument(projectPath);
        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * Get Premiere Pro version info
 */
function getAppInfo() {
    return JSON.stringify({
        name: app.name,
        version: app.version,
        buildNumber: app.build
    });
}

/**
 * Show alert in Premiere
 * @param {string} message - Message to display
 */
function showAlert(message) {
    alert(message, 'Team Sync');
}

/**
 * Get list of recent files (if available)
 */
function getRecentFiles() {
    // Premiere doesn't expose recent files via ExtendScript
    // This is a placeholder for future enhancement
    return JSON.stringify([]);
}

/**
 * Get all media files used in the project
 * Scans the project panel for all imported media
 */
function getProjectMediaFiles() {
    try {
        if (!app.project) {
            return JSON.stringify({ error: 'No project open', files: [] });
        }

        var files = [];
        var rootItem = app.project.rootItem;

        // Recursively scan all project items
        scanProjectItems(rootItem, files);

        return JSON.stringify({
            projectName: app.project.name,
            projectPath: app.project.path,
            files: files
        });
    } catch (e) {
        return JSON.stringify({ error: e.message, files: [] });
    }
}

/**
 * Recursively scan project items for media files
 */
function scanProjectItems(item, files) {
    if (!item) return;

    var children = item.children;
    if (!children) return;

    for (var i = 0; i < children.numItems; i++) {
        var child = children[i];

        if (child.type === ProjectItemType.BIN) {
            // It's a folder, recurse into it
            scanProjectItems(child, files);
        } else if (child.type === ProjectItemType.CLIP ||
            child.type === ProjectItemType.FILE) {
            // It's a media file
            var filePath = '';
            try {
                filePath = child.getMediaPath();
            } catch (e) {
                // Some items don't have a media path
            }

            if (filePath && filePath !== '') {
                files.push({
                    name: child.name,
                    path: filePath,
                    type: getMediaType(child),
                    inPoint: child.getInPoint ? child.getInPoint().seconds : 0,
                    outPoint: child.getOutPoint ? child.getOutPoint().seconds : 0
                });
            }
        }
    }
}

/**
 * Get the type of media item
 */
function getMediaType(item) {
    try {
        // Check if it has video/audio streams
        var hasVideo = item.hasVideo ? item.hasVideo() : false;
        var hasAudio = item.hasAudio ? item.hasAudio() : false;

        if (hasVideo && hasAudio) return 'video';
        if (hasVideo) return 'video';
        if (hasAudio) return 'audio';

        // Fallback to checking file extension
        var name = item.name.toLowerCase();
        if (name.match(/\.(mp4|mov|avi|mkv|wmv|m4v|mxf|prores)$/)) return 'video';
        if (name.match(/\.(mp3|wav|aac|m4a|flac|ogg|aif|aiff)$/)) return 'audio';
        if (name.match(/\.(jpg|jpeg|png|gif|bmp|tiff|psd|ai|eps)$/)) return 'image';
        if (name.match(/\.(mogrt|prproj)$/)) return 'project';

        return 'other';
    } catch (e) {
        return 'unknown';
    }
}

/**
 * Get files from active sequence/timeline
 */
function getTimelineFiles() {
    try {
        if (!app.project) {
            return JSON.stringify({ error: 'No project open', files: [] });
        }

        var sequence = app.project.activeSequence;
        if (!sequence) {
            return JSON.stringify({ error: 'No active sequence', files: [] });
        }

        var files = [];
        var seenPaths = {};  // Avoid duplicates

        // Scan video tracks
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
            var track = sequence.videoTracks[v];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.projectItem) {
                    try {
                        var path = clip.projectItem.getMediaPath();
                        if (path && !seenPaths[path]) {
                            seenPaths[path] = true;
                            var fileEntry = {
                                name: clip.projectItem.name,
                                path: path,
                                type: getMediaType(clip.projectItem)
                            };
                            // Detect Dynamic Link / AE clips
                            if (path.match(/\.aep$/i)) {
                                fileEntry.isAep = true;
                                fileEntry.compName = clip.projectItem.name;
                                // Use actual .aep filename (not comp name) to avoid subfolder issues
                                var lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                                if (lastSlash >= 0) {
                                    fileEntry.name = path.substring(lastSlash + 1);
                                }
                            }
                            files.push(fileEntry);
                        } else if (path && path.match(/\.aep$/i) && seenPaths[path]) {
                            // Same .aep but different comp - add comp name to existing entry
                            for (var fi = 0; fi < files.length; fi++) {
                                if (files[fi].path === path && files[fi].isAep) {
                                    if (files[fi].compNames) {
                                        files[fi].compNames.push(clip.projectItem.name);
                                    } else {
                                        files[fi].compNames = [files[fi].compName, clip.projectItem.name];
                                    }
                                    break;
                                }
                            }
                        }
                    } catch (e) { }
                }
            }
        }

        // Scan audio tracks
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
            var aTrack = sequence.audioTracks[a];
            for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
                var aClip = aTrack.clips[ac];
                if (aClip.projectItem) {
                    try {
                        var aPath = aClip.projectItem.getMediaPath();
                        if (aPath && !seenPaths[aPath]) {
                            seenPaths[aPath] = true;
                            var aFileEntry = {
                                name: aClip.projectItem.name,
                                path: aPath,
                                type: getMediaType(aClip.projectItem)
                            };
                            if (aPath.match(/\.aep$/i)) {
                                aFileEntry.isAep = true;
                                aFileEntry.compName = aClip.projectItem.name;
                            }
                            files.push(aFileEntry);
                        } else if (aPath && aPath.match(/\.aep$/i) && seenPaths[aPath]) {
                            for (var afi = 0; afi < files.length; afi++) {
                                if (files[afi].path === aPath && files[afi].isAep) {
                                    if (files[afi].compNames) {
                                        files[afi].compNames.push(aClip.projectItem.name);
                                    } else {
                                        files[afi].compNames = [files[afi].compName, aClip.projectItem.name];
                                    }
                                    break;
                                }
                            }
                        }
                    } catch (e) { }
                }
            }
        }

        return JSON.stringify({
            sequenceName: sequence.name,
            files: files
        });
    } catch (e) {
        return JSON.stringify({ error: e.message, files: [] });
    }
}

/**
 * Get footage files from an After Effects project via BridgeTalk
 * @param {string} aepPath - Full path to the .aep file
 * @param {string} compNamesJSON - JSON array of composition names to scan
 */
function getAEFootageFiles(aepPath, compNamesJSON) {
    try {
        // Build the AE script as a string
        // IMPORTANT: AE ExtendScript has NO native JSON object,
        // so we build a pipe-delimited string instead
        var aeScript = '';
        aeScript += 'var filePaths = [];';
        aeScript += 'var fileNames = [];';
        aeScript += 'var errorMsg = "";';
        aeScript += 'try {';
        // Open the .aep file if not already open
        aeScript += 'var aepFile = new File("' + aepPath.replace(/\\/g, '/').replace(/"/g, '\\"') + '");';
        aeScript += 'var alreadyOpen = false;';
        aeScript += 'if (app.project && app.project.file) {';
        aeScript += '  var curPath = app.project.file.fsName.replace(/\\\\/g, "/").toLowerCase();';
        aeScript += '  var targetPath = aepFile.fsName.replace(/\\\\/g, "/").toLowerCase();';
        aeScript += '  if (curPath === targetPath) { alreadyOpen = true; }';
        aeScript += '}';
        aeScript += 'if (!alreadyOpen) { app.open(aepFile); }';
        // Comp names array (embedded directly as JS literal)
        aeScript += 'var compNames = ' + compNamesJSON + ';';
        aeScript += 'var seenPaths = {};';
        // Recursive comp scanner
        aeScript += 'function scanComp(comp, visited) {';
        aeScript += '  if (visited[comp.name]) return;';
        aeScript += '  visited[comp.name] = true;';
        aeScript += '  for (var i = 1; i <= comp.numLayers; i++) {';
        aeScript += '    var layer = comp.layer(i);';
        aeScript += '    try {';
        aeScript += '      if (layer.source) {';
        aeScript += '        if (layer.source instanceof FootageItem && layer.source.file) {';
        aeScript += '          var p = layer.source.file.fsName;';
        aeScript += '          if (!seenPaths[p]) {';
        aeScript += '            seenPaths[p] = true;';
        aeScript += '            filePaths.push(p);';
        aeScript += '            fileNames.push(layer.source.name);';
        aeScript += '          }';
        aeScript += '        } else if (layer.source instanceof CompItem) {';
        aeScript += '          scanComp(layer.source, visited);';
        aeScript += '        }';
        aeScript += '      }';
        aeScript += '    } catch(le) {}';
        aeScript += '  }';
        aeScript += '}';
        // Find and scan specified compositions first (timeline-referenced comps)
        aeScript += 'for (var i = 1; i <= app.project.numItems; i++) {';
        aeScript += '  var item = app.project.item(i);';
        aeScript += '  if (item instanceof CompItem) {';
        aeScript += '    for (var cn = 0; cn < compNames.length; cn++) {';
        aeScript += '      if (item.name === compNames[cn]) {';
        aeScript += '        scanComp(item, {});';
        aeScript += '        break;';
        aeScript += '      }';
        aeScript += '    }';
        aeScript += '  }';
        aeScript += '}';
        // Reliability mode: also include all file-backed footage items in the AE project.
        // This ensures assets not reachable from the queried comp names are still discovered.
        aeScript += 'for (var ai = 1; ai <= app.project.numItems; ai++) {';
        aeScript += '  var aItem = app.project.item(ai);';
        aeScript += '  try {';
        aeScript += '    if (aItem instanceof FootageItem && aItem.file) {';
        aeScript += '      var fp = aItem.file.fsName;';
        aeScript += '      if (fp && !seenPaths[fp]) {';
        aeScript += '        seenPaths[fp] = true;';
        aeScript += '        filePaths.push(fp);';
        aeScript += '        fileNames.push(aItem.name);';
        aeScript += '      }';
        aeScript += '    }';
        aeScript += '  } catch(allErr) {}';
        aeScript += '}';
        aeScript += '} catch(e) { errorMsg = e.message || String(e); }';
        // Build result as pipe-delimited string (no JSON needed)
        // Format: "OK|name1>>path1|name2>>path2|..." or "ERROR|message"
        aeScript += 'var resultStr = "";';
        aeScript += 'if (errorMsg !== "") {';
        aeScript += '  resultStr = "ERROR|" + errorMsg;';
        aeScript += '} else {';
        aeScript += '  resultStr = "OK";';
        aeScript += '  for (var r = 0; r < filePaths.length; r++) {';
        aeScript += '    resultStr += "|" + fileNames[r] + ">>" + filePaths[r];';
        aeScript += '  }';
        aeScript += '}';
        aeScript += 'resultStr;';

        // Check if AE is running, launch if needed
        if (!BridgeTalk.isRunning('aftereffects')) {
            BridgeTalk.launch('aftereffects');
            var waitCount = 0;
            while (!BridgeTalk.isRunning('aftereffects') && waitCount < 15) {
                $.sleep(2000);
                waitCount++;
            }
            if (!BridgeTalk.isRunning('aftereffects')) {
                return JSON.stringify({ error: 'After Effects could not be launched', files: [] });
            }
            // Extra wait for AE to fully initialize
            $.sleep(3000);
        }

        // Send via BridgeTalk with synchronous timeout
        var bt = new BridgeTalk();
        bt.target = 'aftereffects';
        bt.body = aeScript;

        var btResult = null;
        var btError = null;
        var btDone = false;

        bt.onResult = function (msg) {
            btResult = msg.body;
            btDone = true;
        };

        bt.onError = function (msg) {
            btError = msg.body;
            btDone = true;
        };

        bt.send();

        // Wait for response with pump (up to 60 seconds)
        var elapsed = 0;
        while (!btDone && elapsed < 60000) {
            BridgeTalk.pump();
            $.sleep(200);
            elapsed += 200;
        }

        if (btError) {
            return JSON.stringify({ error: 'AE script error: ' + btError, files: [] });
        }

        if (!btDone) {
            return JSON.stringify({ error: 'AE did not respond within 60 seconds', files: [] });
        }

        if (!btResult) {
            return JSON.stringify({ error: 'Empty response from AE', files: [] });
        }

        // Parse pipe-delimited result from AE
        // Format: "OK|name1>>path1|name2>>path2|..." or "ERROR|message"
        var parts = btResult.split('|');
        var status = parts[0];

        if (status === 'ERROR') {
            return JSON.stringify({ error: parts[1] || 'Unknown AE error', files: [] });
        }

        var files = [];
        for (var p = 1; p < parts.length; p++) {
            var nameAndPath = parts[p].split('>>');
            if (nameAndPath.length === 2) {
                files.push({
                    name: nameAndPath[0],
                    path: nameAndPath[1]
                });
            }
        }

        return JSON.stringify({ files: files, error: null });
    } catch (e) {
        return JSON.stringify({ error: e.message, files: [] });
    }
}

/**
 * Get all OFFLINE media files in the project
 * Used to match with Drive files for auto-linking
 */
function getOfflineFiles() {
    try {
        if (!app.project) {
            return JSON.stringify({ error: 'No project open', files: [] });
        }

        if (!app.project.activeSequence) {
            return JSON.stringify({ error: 'No active sequence', files: [] });
        }

        var offlineFiles = [];
        var seenItems = {}; // Track by nodeId to avoid duplicates
        var sequence = app.project.activeSequence;

        // Check VIDEO tracks for offline clips
        for (var v = 0; v < sequence.videoTracks.numTracks; v++) {
            var track = sequence.videoTracks[v];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.projectItem) {
                    var item = clip.projectItem;
                    var mediaPath = '';
                    try { mediaPath = item.getMediaPath(); } catch (e) { }

                    // Check if media is offline (empty path or file doesn't exist)
                    if (!mediaPath || mediaPath === '' || item.isOffline()) {
                        if (!seenItems[item.nodeId]) {
                            seenItems[item.nodeId] = true;
                            // Extract filename from the original path
                            var origFileName = item.name;
                            if (mediaPath && mediaPath !== '') {
                                var lastSlash = Math.max(mediaPath.lastIndexOf('\\'), mediaPath.lastIndexOf('/'));
                                if (lastSlash >= 0) origFileName = mediaPath.substring(lastSlash + 1);
                            }
                            offlineFiles.push({
                                name: item.name,
                                nodeId: item.nodeId,
                                type: 'video',
                                fileName: origFileName,
                                lastPath: mediaPath || ''
                            });
                        }
                    }
                }
            }
        }

        // Check AUDIO tracks for offline clips
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) {
            var track = sequence.audioTracks[a];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.projectItem) {
                    var item = clip.projectItem;
                    var mediaPath = '';
                    try { mediaPath = item.getMediaPath(); } catch (e) { }

                    if (!mediaPath || mediaPath === '' || item.isOffline()) {
                        if (!seenItems[item.nodeId]) {
                            seenItems[item.nodeId] = true;
                            var origFileName = item.name;
                            if (mediaPath && mediaPath !== '') {
                                var lastSlash = Math.max(mediaPath.lastIndexOf('\\'), mediaPath.lastIndexOf('/'));
                                if (lastSlash >= 0) origFileName = mediaPath.substring(lastSlash + 1);
                            }
                            offlineFiles.push({
                                name: item.name,
                                nodeId: item.nodeId,
                                type: 'audio',
                                fileName: origFileName,
                                lastPath: mediaPath || ''
                            });
                        }
                    }
                }
            }
        }

        return JSON.stringify({
            count: offlineFiles.length,
            files: offlineFiles
        });
    } catch (e) {
        return JSON.stringify({ error: e.message, files: [] });
    }
}

/**
 * Auto-relink all offline media by scanning a target folder
 * @param {string} targetFolder - The folder where downloaded files are
 */
function autoRelinkOfflineMedia(targetFolder) {
    try {
        if (!app.project) return JSON.stringify({ success: false, error: 'No project', relinked: 0 });

        var relinked = 0;
        var failed = 0;
        var seenItems = {};

        // Scan all project items (not just timeline) for offline media
        function scanAndRelink(item) {
            if (!item) return;

            if (item.type === ProjectItemType.CLIP || item.type === ProjectItemType.FILE) {
                if (!seenItems[item.nodeId]) {
                    seenItems[item.nodeId] = true;
                    var mediaPath = '';
                    try { mediaPath = item.getMediaPath(); } catch (e) { }

                    var isOffline = false;
                    try { isOffline = item.isOffline(); } catch (e) { }

                    if (isOffline || !mediaPath || mediaPath === '') {
                        // Extract the original filename
                        var origFileName = '';
                        if (mediaPath && mediaPath !== '') {
                            var lastSlash = Math.max(mediaPath.lastIndexOf('\\'), mediaPath.lastIndexOf('/'));
                            origFileName = lastSlash >= 0 ? mediaPath.substring(lastSlash + 1) : mediaPath;
                        } else {
                            origFileName = item.name;
                        }

                        // Try to find the file in targetFolder (recursively)
                        var folderObj = new Folder(targetFolder);
                        if (folderObj.exists) {
                            var foundFile = findFileRecursive(folderObj, origFileName);
                            if (!foundFile) {
                                // Also try matching by item.name + common extensions
                                var extensions = ['.aep', '.mp4', '.mov', '.wav', '.mp3', '.png', '.jpg', '.webp', '.psd', '.ai', '.tga', '.exr'];
                                for (var ei = 0; ei < extensions.length; ei++) {
                                    foundFile = findFileRecursive(folderObj, item.name + extensions[ei]);
                                    if (foundFile) break;
                                }
                            }
                            if (foundFile && item.canChangeMediaPath()) {
                                try {
                                    var success = item.changeMediaPath(foundFile.fsName, true);
                                    if (success) {
                                        relinked++;
                                    } else {
                                        failed++;
                                    }
                                } catch (re) {
                                    failed++;
                                }
                            } else {
                                failed++;
                            }
                        }
                    }
                }
            }

            // Recurse into children
            if (item.children) {
                for (var i = 0; i < item.children.numItems; i++) {
                    scanAndRelink(item.children[i]);
                }
            }
        }

        scanAndRelink(app.project.rootItem);

        // Save project after relinking
        if (relinked > 0) {
            app.project.save();
        }

        return JSON.stringify({ success: true, relinked: relinked, failed: failed });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message, relinked: 0 });
    }
}

/**
 * Recursively find a file by name in a folder
 */
function findFileRecursive(folder, fileName) {
    if (!folder || !folder.exists) return null;

    // Check direct children first
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof File) {
            if (files[i].displayName === fileName || files[i].name === fileName) {
                return files[i];
            }
        }
    }
    // Recurse into subfolders
    for (var j = 0; j < files.length; j++) {
        if (files[j] instanceof Folder) {
            var result = findFileRecursive(files[j], fileName);
            if (result) return result;
        }
    }
    return null;
}

/**
 * Relink a project item to a new file path
 * @param {string} nodeId - The nodeId of the project item (from getOfflineFiles)
 * @param {string} newPath - The local path to the downloaded file
 */
function relinkMedia(nodeId, newPath) {
    try {
        if (!app.project) return JSON.stringify({ success: false, error: 'No project' });

        // Find item by nodeId
        // Note: Premiere doesn't have direct getByNodeId, we scan for it
        var targetItem = findItemByNodeId(app.project.rootItem, nodeId);

        if (targetItem) {
            if (targetItem.canChangeMediaPath()) {
                var success = targetItem.changeMediaPath(newPath);
                return JSON.stringify({ success: success });
            } else {
                return JSON.stringify({ success: false, error: 'Cannot change media path' });
            }
        }

        return JSON.stringify({ success: false, error: 'Item not found' });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * Helper to find item by Node ID
 */
function findItemByNodeId(item, id) {
    if (!item) return null;
    if (item.nodeId === id) return item;

    // Recursively search children for ALL item types
    if (item.children) {
        for (var i = 0; i < item.children.numItems; i++) {
            var result = findItemByNodeId(item.children[i], id);
            if (result) return result;
        }
    }

    return null;
}
