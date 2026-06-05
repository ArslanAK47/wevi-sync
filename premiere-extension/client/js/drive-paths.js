/* ============================================
   DRIVE PATH HELPERS (pure, Node-exportable)
   --------------------------------------------
   Single source of truth for translating local
   file paths <-> Drive-relative paths, building
   the AE relink manifest, and choosing relink
   targets on pull. No DOM / no network here so
   it can be unit-tested in plain Node.
   ============================================ */
(function () {
    'use strict';

    var path = (typeof require !== 'undefined') ? require('path') : null;
    // Drive paths are always Windows paths in this app; use win32 semantics
    // so behaviour is identical whether tests run on Windows or POSIX.
    var win = path ? path.win32 : null;

    function toForwardSlash(value) {
        return (value || '').replace(/\\/g, '/');
    }
    function trimLeadingSlashes(value) {
        return (value || '').replace(/^[/\\]+/, '');
    }
    function sanitizeRelativePath(value) {
        return trimLeadingSlashes(toForwardSlash(value).replace(/\/+/g, '/'));
    }
    function basename(p) {
        if (!p) return '';
        return win ? win.basename(p) : (p.split(/[\\/]/).pop() || p);
    }

    /**
     * Translate a local file to its Drive-relative path.
     * Mirrors the original buildDriveRelativePath in upload-helper.js so the
     * uploader and the AE-manifest builder always agree on where a file lands.
     * @param {{path:string,name?:string,type?:string}} file
     * @param {string} projectRoot  dir of the .prproj (raw or fwd-slash)
     * @param {string} baseFolder   same as projectRoot in practice
     */
    function computeDriveRelativePath(file, projectRoot, baseFolder) {
        if (!file || !file.path) return file && file.name;
        if (file.type === 'project') return basename(file.path);

        var absolute = win ? win.resolve(file.path) : file.path;
        var normalizedAbsolute = toForwardSlash(absolute).toLowerCase();
        var normalizedRoot = toForwardSlash(projectRoot || '').toLowerCase();

        // Project-internal files keep a clean relative tree.
        if (normalizedRoot &&
            (normalizedAbsolute === normalizedRoot || normalizedAbsolute.indexOf(normalizedRoot + '/') === 0)) {
            var rel = win ? win.relative(baseFolder || projectRoot || '', absolute) : absolute;
            return sanitizeRelativePath(rel);
        }

        // External files: preserve uniqueness with an external_<drive> prefix.
        var driveMatch = absolute.match(/^([a-zA-Z]):[\\/]/);
        var drivePrefix = driveMatch ? ('external_' + driveMatch[1].toLowerCase()) : 'external';
        var withoutDrive = absolute.replace(/^[a-zA-Z]:[\\/]/, '');
        return sanitizeRelativePath(drivePrefix + '/' + withoutDrive);
    }

    /**
     * Build the per-.aep relink manifest written on push.
     * Footage driveRelativePath is computed with the SAME function the uploader
     * uses, guaranteeing push paths == pull paths.
     */
    function buildAeRelinkManifest(aepFile, footageList, projectRoot, baseFolder) {
        var aepRel = computeDriveRelativePath(
            { path: aepFile.path, name: basename(aepFile.path), type: 'file' },
            projectRoot, baseFolder);
        return {
            schemaVersion: 1,
            aepOriginalPath: aepFile.path,
            aepDriveRelativePath: sanitizeRelativePath(aepRel),
            footage: (footageList || []).map(function (f) {
                var rel = computeDriveRelativePath(
                    { path: f.path, name: basename(f.path), type: 'file' },
                    projectRoot, baseFolder);
                return {
                    originalPath: f.path,
                    driveRelativePath: sanitizeRelativePath(rel),
                    basename: basename(f.path)
                };
            })
        };
    }

    /**
     * Index of downloaded files (relative paths under the pull target folder)
     * for relink lookups. Used by both the .prproj patch and AE fallback.
     * @param {string[]} downloadedRelPaths  e.g. ["media/clip.mp4","ae/footage/clip.mp4"]
     */
    function buildRelinkIndex(downloadedRelPaths) {
        var byRel = {};
        var byBase = {};
        (downloadedRelPaths || []).forEach(function (rel) {
            var norm = sanitizeRelativePath(rel).toLowerCase();
            byRel[norm] = rel;
            var base = norm.split('/').pop();
            (byBase[base] = byBase[base] || []).push(rel);
        });
        return { byRel: byRel, byBase: byBase };
    }

    function pathSegments(p) {
        return toForwardSlash(p).toLowerCase().split('/').filter(Boolean);
    }

    /**
     * Choose which downloaded file an old absolute path should relink to.
     * Prefers a unique basename match; when several downloaded files share the
     * basename, disambiguates by the longest matching trailing path segments.
     * Returns the chosen relative path, or null if absent/ambiguous.
     */
    function chooseRelinkTarget(originalPath, index) {
        if (!originalPath || !index) return null;
        var base = basename(originalPath).toLowerCase();
        var candidates = index.byBase[base];
        if (!candidates || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        var oldSegs = pathSegments(originalPath);
        var best = null, bestScore = -1, tie = false;
        candidates.forEach(function (rel) {
            var segs = pathSegments(rel);
            var score = 0;
            var i = oldSegs.length - 1, j = segs.length - 1;
            while (i >= 0 && j >= 0 && oldSegs[i] === segs[j]) { score++; i--; j--; }
            if (score > bestScore) { bestScore = score; best = rel; tie = false; }
            else if (score === bestScore) { tie = true; }
        });
        return tie ? null : best;
    }

    /**
     * Resolve the AE relink old->new map from a manifest after a pull.
     * Uses the manifest's exact driveRelativePath; falls back to a basename
     * lookup in the downloaded index when the exact file isn't present.
     * @returns {{oldPath:string,newPath:string,resolved:boolean}[]}
     */
    function resolveRelinkMappings(manifest, targetFolder, downloadedRelPaths) {
        var index = buildRelinkIndex(downloadedRelPaths || []);
        var joinWin = function (a, b) {
            if (win) return win.join(a, b);
            return (a.replace(/[\\/]+$/, '') + '\\' + b.replace(/[\\/]+/g, '\\'));
        };
        return (manifest.footage || []).map(function (f) {
            var rel = f.driveRelativePath;
            var norm = sanitizeRelativePath(rel).toLowerCase();
            var chosen = index.byRel[norm] || chooseRelinkTarget(f.originalPath, index) || rel;
            var resolved = !!(index.byRel[norm] || (index.byBase[(f.basename || '').toLowerCase()]));
            return {
                oldPath: f.originalPath,
                newPath: joinWin(targetFolder, sanitizeRelativePath(chosen).replace(/\//g, '\\')),
                resolved: resolved
            };
        });
    }

    var DrivePaths = {
        toForwardSlash: toForwardSlash,
        sanitizeRelativePath: sanitizeRelativePath,
        basename: basename,
        computeDriveRelativePath: computeDriveRelativePath,
        buildAeRelinkManifest: buildAeRelinkManifest,
        buildRelinkIndex: buildRelinkIndex,
        chooseRelinkTarget: chooseRelinkTarget,
        resolveRelinkMappings: resolveRelinkMappings
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = DrivePaths;
    if (typeof window !== 'undefined') window.DrivePaths = DrivePaths;
    else if (typeof globalThis !== 'undefined') globalThis.DrivePaths = DrivePaths;
})();
