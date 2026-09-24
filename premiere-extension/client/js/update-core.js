/* ============================================
   UPDATE CORE (pure, Node-exportable)
   --------------------------------------------
   Logic shared by the panel's auto-updater and
   the release script: version compare, the
   files.json manifest format, and per-file
   verification. No DOM, no network.
   ============================================ */
(function () {
    'use strict';

    var MANIFEST_NAME = 'files.json';

    // Files the updater must never download/overwrite itself: version.json is
    // written LAST (it marks the update complete), files.json is bookkeeping.
    var RESERVED = { 'version.json': true, 'files.json': true };

    /** 1 if a > b, -1 if a < b, 0 if equal ("1.6.10" > "1.6.9"). */
    function compareVersions(a, b) {
        var pa = String(a || '0').split('.').map(Number);
        var pb = String(b || '0').split('.').map(Number);
        for (var i = 0; i < 3; i++) {
            var na = pa[i] || 0, nb = pb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    }

    /** "1.6.3" + "patch" -> "1.6.4"; "minor" -> "1.7.0"; "major" -> "2.0.0"; "1.8.0" -> "1.8.0". */
    function bumpVersion(current, kind) {
        if (/^\d+\.\d+\.\d+$/.test(kind || '')) return kind;
        var p = String(current || '0.0.0').split('.').map(Number);
        var ma = p[0] || 0, mi = p[1] || 0, pa = p[2] || 0;
        if (kind === 'major') return (ma + 1) + '.0.0';
        if (kind === 'minor') return ma + '.' + (mi + 1) + '.0';
        if (kind === 'patch') return ma + '.' + mi + '.' + (pa + 1);
        throw new Error('Unknown version bump "' + kind + '" (use patch, minor, major or X.Y.Z)');
    }

    /** Manifest paths are always forward-slash, relative, no "..". */
    function isSafeRelPath(p) {
        if (typeof p !== 'string' || !p) return false;
        if (p.indexOf('\\') !== -1 || p.charAt(0) === '/' || /^[a-zA-Z]:/.test(p)) return false;
        var parts = p.split('/');
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === '' || parts[i] === '.' || parts[i] === '..') return false;
        }
        return true;
    }

    /**
     * Validate a parsed files.json. Returns the file entries that the updater
     * should download (reserved files removed). Throws on malformed input so a
     * broken manifest can never half-apply.
     */
    function parseManifest(obj) {
        if (!obj || typeof obj !== 'object' || !Array.isArray(obj.files)) {
            throw new Error('files.json is malformed (no files array)');
        }
        var out = [];
        var seen = {};
        obj.files.forEach(function (f) {
            if (!f || !isSafeRelPath(f.path)) throw new Error('files.json has an unsafe path: ' + (f && f.path));
            if (typeof f.size !== 'number' || !/^[0-9a-f]{64}$/.test(f.sha256 || '')) {
                throw new Error('files.json entry is missing size/sha256: ' + f.path);
            }
            if (seen[f.path]) throw new Error('files.json lists a file twice: ' + f.path);
            seen[f.path] = true;
            if (!RESERVED[f.path]) out.push({ path: f.path, size: f.size, sha256: f.sha256 });
        });
        if (out.length === 0) throw new Error('files.json lists no files');
        return out;
    }

    /**
     * Paths present in the previously installed manifest but gone from the new
     * one: safe to delete, because we only ever delete files we shipped.
     */
    function removedPaths(oldEntries, newEntries) {
        var keep = {};
        (newEntries || []).forEach(function (f) { keep[f.path] = true; });
        return (oldEntries || [])
            .map(function (f) { return f.path; })
            .filter(function (p) { return isSafeRelPath(p) && !RESERVED[p] && !keep[p]; });
    }

    /** Does a downloaded file match its manifest entry? sha256Hex is computed by the caller. */
    function verifyEntry(entry, size, sha256Hex) {
        if (size !== entry.size) return 'size mismatch (got ' + size + ', expected ' + entry.size + ')';
        if (String(sha256Hex).toLowerCase() !== entry.sha256) return 'checksum mismatch';
        return null;
    }

    /** True if any host/ (ExtendScript) file changed: those need an app restart, not just a panel reload. */
    function hostFilesChanged(entries) {
        return (entries || []).some(function (f) { return f.path.indexOf('host/') === 0 || f.path.indexOf('CSXS/') === 0; });
    }

    var UpdateCore = {
        MANIFEST_NAME: MANIFEST_NAME,
        compareVersions: compareVersions,
        bumpVersion: bumpVersion,
        isSafeRelPath: isSafeRelPath,
        parseManifest: parseManifest,
        removedPaths: removedPaths,
        verifyEntry: verifyEntry,
        hostFilesChanged: hostFilesChanged
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = UpdateCore;
    if (typeof window !== 'undefined') window.UpdateCore = UpdateCore;
    else if (typeof globalThis !== 'undefined') globalThis.UpdateCore = UpdateCore;
})();
