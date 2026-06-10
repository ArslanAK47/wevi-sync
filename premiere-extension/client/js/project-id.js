/* ============================================
   PROJECT IDENTITY + SYNC STATE (pure-ish, Node-exportable)
   --------------------------------------------
   - Stable per-project unique ID (sidecar next to the .prproj)
   - Drive folder naming/parsing  (cleanName__<id>)
   - Folder-resolution decision (exact / byId / adopt-legacy / create)
   - Push conflict detection (lost-update guard)
   - Lock pure helpers (stale / owner / render-shape)
   fs is injected so the core stays unit-testable.
   ============================================ */
(function () {
    'use strict';

    var path = (typeof require !== 'undefined') ? require('path') : null;
    var win = path ? path.win32 : null;
    var crypto = (typeof require !== 'undefined') ? require('crypto') : null;

    function basename(p) {
        if (!p) return '';
        return win ? win.basename(p) : (p.split(/[\\/]/).pop() || p);
    }
    function dirname(p) {
        if (!p) return '';
        return win ? win.dirname(p) : p.replace(/[\\/][^\\/]*$/, '');
    }

    function computeCleanName(prprojPath) {
        var b = basename(prprojPath || '');
        return b.replace(/\.prproj$/i, '');
    }

    function sidecarPathFor(prprojPath) {
        var dir = dirname(prprojPath);
        var clean = computeCleanName(prprojPath);
        var file = clean + '.wevisync.json';
        return win ? win.join(dir, file) : (dir + '\\' + file);
    }

    function sha1Hex(str) {
        if (crypto) return crypto.createHash('sha1').update(str).digest('hex');
        // tiny non-crypto fallback (only if crypto unavailable); fine for an ID
        var h = 0, i;
        for (i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
        var hex = (h >>> 0).toString(16);
        while (hex.length < 16) hex += hex;
        return hex.slice(0, 40);
    }

    /**
     * Generate a 16-hex projectId. rng/clock injectable for deterministic tests.
     */
    function generateProjectId(cleanName, opts) {
        opts = opts || {};
        var clock = opts.clock || function () { return new Date().toISOString(); };
        var rng = opts.rng || function () {
            return (crypto ? crypto.randomBytes(8).toString('hex') : Math.random().toString(16).slice(2, 18));
        };
        var createdAt = opts.createdAt || clock();
        var seed = (cleanName || '') + '|' + createdAt + '|' + rng();
        return sha1Hex(seed).slice(0, 16);
    }

    function isValidId(id) {
        return typeof id === 'string' && /^[0-9a-f]{16}$/i.test(id);
    }

    /**
     * Read the project sidecar if present & valid, else build a fresh object
     * in memory (NOT written here — the caller writes it on push).
     */
    function loadOrCreateSidecar(prprojPath, fs, opts) {
        opts = opts || {};
        var sidecarPath = sidecarPathFor(prprojPath);
        var cleanName = computeCleanName(prprojPath);
        if (fs && fs.existsSync && fs.existsSync(sidecarPath)) {
            try {
                var parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
                if (parsed && isValidId(parsed.projectId)) {
                    return { projectId: parsed.projectId, cleanName: parsed.cleanName || cleanName,
                             sidecarPath: sidecarPath, created: false, sidecarObject: parsed };
                }
            } catch (e) { /* fall through to regenerate */ }
        }
        var createdAt = opts.createdAt || new Date().toISOString();
        var obj = {
            schemaVersion: 1,
            projectId: generateProjectId(cleanName, { createdAt: createdAt, rng: opts.rng, clock: opts.clock }),
            cleanName: cleanName,
            createdAt: createdAt,
            createdBy: opts.createdBy || ''
        };
        return { projectId: obj.projectId, cleanName: cleanName, sidecarPath: sidecarPath,
                 created: true, sidecarObject: obj };
    }

    function writeSidecar(sidecarPath, obj, fs) {
        if (!fs || !fs.writeFileSync) return false;
        fs.writeFileSync(sidecarPath, JSON.stringify(obj, null, 2));
        return true;
    }

    function legacyPathHash(prprojAbsPath) {
        return sha1Hex((prprojAbsPath || '').toLowerCase()).slice(0, 16);
    }

    function sanitizeName(name) {
        return (name || '').replace(/[\\/:*?"<>|]/g, '').replace(/__+/g, '_').trim();
    }

    function driveFolderName(cleanName, projectId) {
        return sanitizeName(cleanName) + '__' + projectId;
    }

    function parseDriveFolderName(folderName) {
        var name = folderName || '';
        var idx = name.lastIndexOf('__');
        if (idx > 0) {
            var right = name.slice(idx + 2);
            if (isValidId(right)) {
                return { cleanName: name.slice(0, idx), projectId: right.toLowerCase() };
            }
        }
        return { cleanName: name, projectId: null };
    }

    /**
     * Decide how to resolve the top-level project folder among existing children.
     * Pure: returns an action; the Drive HTTP is done by the caller.
     * @param {{id:string,name:string}[]} children
     */
    function decideProjectFolderAction(children, cleanName, projectId) {
        var canonical = driveFolderName(cleanName, projectId);
        children = children || [];
        var i, c, parsed;
        for (i = 0; i < children.length; i++) {
            if (children[i].name === canonical) return { action: 'exact', id: children[i].id, name: canonical };
        }
        for (i = 0; i < children.length; i++) {
            parsed = parseDriveFolderName(children[i].name);
            if (parsed.projectId && parsed.projectId === String(projectId).toLowerCase()) {
                return { action: 'byId', id: children[i].id, name: canonical };
            }
        }
        for (i = 0; i < children.length; i++) {
            c = children[i];
            parsed = parseDriveFolderName(c.name);
            if (parsed.projectId === null && c.name === cleanName) {
                return { action: 'adopt', id: c.id, name: canonical };
            }
        }
        return { action: 'create', name: canonical };
    }

    /**
     * Suggest a distinct name for "Push as new project": appends the editor's
     * name, then a counter, until the name is free among existingNames.
     */
    function suggestForkName(cleanName, editorName, existingNames) {
        var base = sanitizeName(cleanName) || 'Project';
        var who = sanitizeName(String(editorName || '').split('@')[0]).trim() || 'copy';
        var taken = {};
        (existingNames || []).forEach(function (n) { taken[String(n).toLowerCase()] = true; });
        var candidate = base + ' (' + who + ')';
        var i = 2;
        while (taken[candidate.toLowerCase()]) {
            candidate = base + ' (' + who + ' ' + i + ')';
            i++;
        }
        return candidate;
    }

    /**
     * Push lost-update guard. baseline = what we saw at last pull/push.
     * remoteMeta = current Drive .prproj metadata.
     */
    function detectConflict(baseline, remoteMeta) {
        if (!baseline) return { conflict: false, firstPush: true };
        if (!remoteMeta) return { conflict: false, missingRemote: true };
        if (baseline.md5 && remoteMeta.md5 && baseline.md5 === remoteMeta.md5) {
            return { conflict: false };
        }
        if (!baseline.md5 || !remoteMeta.md5) {
            // Fall back to modifiedTime comparison when md5 unavailable.
            var newer = remoteMeta.modifiedTime && baseline.modifiedTime &&
                        remoteMeta.modifiedTime > baseline.modifiedTime;
            if (!newer) return { conflict: false };
        }
        return {
            conflict: true,
            who: (remoteMeta.lastModifyingUser && (remoteMeta.lastModifyingUser.displayName ||
                  remoteMeta.lastModifyingUser.emailAddress)) || 'another editor',
            when: remoteMeta.modifiedTime || ''
        };
    }

    // ---- Lock pure helpers ----
    function isStaleLock(lock, nowMs, maxAgeMs) {
        if (!lock || !lock.lockedAt) return false;
        var t = Date.parse(lock.lockedAt);
        if (isNaN(t)) return false;
        return (nowMs - t) > maxAgeMs;
    }
    function canUnlock(lock, email) {
        return !lock || !lock.email || lock.email === email;
    }
    /**
     * Convert [{cleanName, lock}] into the {project_name, locked_by, ...} shape
     * the existing render code expects.
     */
    function locksToRenderShape(entries, nowMs, maxAgeMs) {
        return (entries || []).filter(function (e) { return e && e.lock; }).map(function (e) {
            return {
                project_name: e.cleanName,
                locked_by: e.lock.lockedBy || e.lock.email || 'someone',
                locked_at: e.lock.lockedAt || '',
                email: e.lock.email || '',
                stale: isStaleLock(e.lock, nowMs || Date.now(), maxAgeMs || (8 * 3600 * 1000))
            };
        });
    }

    var ProjectId = {
        computeCleanName: computeCleanName,
        sidecarPathFor: sidecarPathFor,
        generateProjectId: generateProjectId,
        isValidId: isValidId,
        loadOrCreateSidecar: loadOrCreateSidecar,
        writeSidecar: writeSidecar,
        legacyPathHash: legacyPathHash,
        sanitizeName: sanitizeName,
        driveFolderName: driveFolderName,
        parseDriveFolderName: parseDriveFolderName,
        suggestForkName: suggestForkName,
        decideProjectFolderAction: decideProjectFolderAction,
        detectConflict: detectConflict,
        isStaleLock: isStaleLock,
        canUnlock: canUnlock,
        locksToRenderShape: locksToRenderShape
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = ProjectId;
    if (typeof window !== 'undefined') window.ProjectId = ProjectId;
    else if (typeof globalThis !== 'undefined') globalThis.ProjectId = ProjectId;
})();
