/* ============================================
   TELEMETRY: editor status + debug log for the admin
   --------------------------------------------
   Each editor's panel keeps ONE file in the editor's own Drive,
   "TeamSync-Telemetry-<email>.json", shared (writer) only with
   GoogleDriveConfig.adminEmails. Drive permissions keep editors
   from seeing each other's files; the admin's panel lists every
   file shared with it via the appProperties marker.

   Pure helpers (redact/trimLog/buildSnapshot/...) are exported for
   Node tests; the Drive side only runs inside the panel.
   ============================================ */
(function () {
    'use strict';

    var MARKER_KEY = 'teamsyncTelemetry';
    var FILE_PREFIX = 'TeamSync-Telemetry-';
    var MAX_LOG_LINES = 1500;
    var MAX_LINE_CHARS = 2000;
    var STATE_KEY = 'teamsync_telemetry';

    /* ---------------- pure helpers ---------------- */

    // Anything that could let someone act as the editor on Google must never leave the machine.
    var REDACTIONS = [
        [/Bearer\s+[A-Za-z0-9._~+\/=-]+/g, 'Bearer [REDACTED]'],
        [/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]'],
        [/\b1\/\/[A-Za-z0-9._-]{20,}/g, '[REDACTED_TOKEN]'],
        [/GOCSPX-[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]'],
        [/("(?:access_token|refresh_token|id_token|client_secret|code)"\s*:\s*")[^"]*(")/g, '$1[REDACTED]$2'],
        [/\b((?:access_token|refresh_token|id_token|client_secret|code|token)=)[^&\s"']+/g, '$1[REDACTED]']
    ];

    function redact(text) {
        var s = String(text == null ? '' : text);
        for (var i = 0; i < REDACTIONS.length; i++) s = s.replace(REDACTIONS[i][0], REDACTIONS[i][1]);
        return s;
    }

    /** Last `max` lines, each redacted and clipped so one huge JSON dump can't dominate. */
    function trimLog(lines, max) {
        max = max || MAX_LOG_LINES;
        var src = Array.isArray(lines) ? lines : [];
        return src.slice(Math.max(0, src.length - max)).map(function (l) {
            var r = redact(l);
            return r.length > MAX_LINE_CHARS ? r.slice(0, MAX_LINE_CHARS) + ' …[clipped]' : r;
        });
    }

    function telemetryFileName(email) {
        return FILE_PREFIX + String(email || 'unknown').toLowerCase().replace(/[^a-z0-9@._-]/g, '_') + '.json';
    }

    function isAdminEmail(email, adminEmails) {
        var e = String(email || '').trim().toLowerCase();
        if (!e) return false;
        return (adminEmails || []).some(function (a) { return String(a).trim().toLowerCase() === e; });
    }

    /** Everything the admin sees for one editor. `info` is gathered by the panel (or a test). */
    function buildSnapshot(info) {
        info = info || {};
        return {
            schema: 1,
            email: info.email || '',
            name: info.name || '',
            extensionVersion: info.extensionVersion || '0.0.0',
            hostApp: info.hostApp || '',
            hostVersion: info.hostVersion || '',
            os: info.os || '',
            syncFolder: info.syncFolder || '',
            installPath: info.installPath || '',
            installWritable: info.installWritable !== false,
            teamFolderId: info.teamFolderId || '',
            sessionStarted: info.sessionStarted || '',
            lastSeen: info.now || new Date().toISOString(),
            update: info.update || {},
            lastError: info.lastError ? redact(info.lastError) : '',
            log: trimLog(info.log, info.maxLines)
        };
    }

    /* ---------------- panel runtime ---------------- */

    var sessionStarted = new Date().toISOString();
    var updateInfo = {};
    var lastError = '';
    var lastErrorFlush = 0;
    var flushing = null;
    var flushQueued = false;

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveState(s) {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { }
    }

    function hostEnv() {
        try {
            if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.getHostEnvironment) {
                var env = JSON.parse(__adobe_cep__.getHostEnvironment());
                return { appName: env.appName || '', appVersion: env.appVersion || '' };
            }
        } catch (e) { }
        return { appName: '', appVersion: '' };
    }

    function osString() {
        try {
            var os = require('os');
            return os.type() + ' ' + os.release() + ' (' + os.arch() + ')';
        } catch (e) {
            return (typeof navigator !== 'undefined' && navigator.platform) || '';
        }
    }

    function currentLog() {
        // debugLogs is main.js's console capture buffer (a global lexical binding).
        try { return typeof debugLogs !== 'undefined' ? debugLogs : []; } catch (e) { return []; }
    }

    function gatherSnapshot() {
        var env = hostEnv();
        var cfg = (typeof Config !== 'undefined' && Config.data) || {};
        var local = (typeof getLocalVersion === 'function') ? getLocalVersion() : {};
        var installPath = '';
        var installWritable = true;
        try {
            installPath = getExtensionRoot();
            installWritable = checkInstallWritable(installPath).ok;
        } catch (e) { }
        return buildSnapshot({
            email: cfg.editorEmail,
            name: cfg.editorName,
            extensionVersion: local.version,
            hostApp: env.appName,
            hostVersion: env.appVersion,
            os: osString(),
            syncFolder: cfg.syncFolder,
            installPath: installPath,
            installWritable: installWritable,
            teamFolderId: cfg.teamFolderId,
            sessionStarted: sessionStarted,
            update: updateInfo,
            lastError: lastError,
            log: currentLog()
        });
    }

    function adminEmails() {
        return (typeof GoogleDriveConfig !== 'undefined' && GoogleDriveConfig.adminEmails) || [];
    }

    async function driveFetch(url, opts) {
        var token = await GoogleDrive.getValidToken();
        if (!token) throw new Error('Not signed in to Google Drive');
        opts = opts || {};
        opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
        return fetch(url, opts);
    }

    async function findOwnFile(name) {
        var q = "name='" + driveQ(name) + "' and 'me' in owners and trashed=false";
        var res = await driveFetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id)');
        if (!res.ok) throw new Error('Telemetry lookup failed: HTTP ' + res.status);
        var data = await res.json();
        return (data.files && data.files[0] && data.files[0].id) || null;
    }

    async function createFile(name, body) {
        var boundary = 'teamsync' + Date.now();
        var meta = {
            name: name,
            mimeType: 'application/json',
            description: 'Team Sync panel status + debug log, shared with the team admin only.',
            appProperties: {}
        };
        meta.appProperties[MARKER_KEY] = '1';
        var multipart =
            '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n' +
            '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n' +
            '--' + boundary + '--';
        var res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body: multipart
        });
        if (!res.ok) throw new Error('Telemetry create failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        return (await res.json()).id;
    }

    function patchContent(fileId, body) {
        return driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body
        });
    }

    async function shareWithAdmins(fileId, ownerEmail, alreadyShared) {
        var done = (alreadyShared || []).slice();
        var admins = adminEmails();
        for (var i = 0; i < admins.length; i++) {
            var a = String(admins[i]).toLowerCase();
            if (a === String(ownerEmail || '').toLowerCase() || done.indexOf(a) !== -1) continue;
            var res = await driveFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions?sendNotificationEmail=false', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: a })
            });
            if (res.ok) done.push(a);
            else originalWarn('[Telemetry] Could not share with admin ' + a + ': HTTP ' + res.status);
        }
        return done;
    }

    // Log through the untouched console so telemetry chatter doesn't flood the log it uploads.
    function originalWarn(msg) {
        try { (typeof originalConsoleWarn === 'function' ? originalConsoleWarn : console.warn).call(console, msg); } catch (e) { }
    }

    async function doFlush() {
        if (typeof GoogleDrive === 'undefined') return;
        var cfg = (typeof Config !== 'undefined' && Config.data) || {};
        if (!cfg.editorEmail) return; // identity not known yet; initializeSync fills it
        var body = JSON.stringify(gatherSnapshot());
        var name = telemetryFileName(cfg.editorEmail);
        var state = loadState();
        if (state.email !== cfg.editorEmail) state = { email: cfg.editorEmail };

        if (state.fileId) {
            var res = await patchContent(state.fileId, body);
            if (res.status === 404 || res.status === 403) state.fileId = null; // deleted on Drive: find/recreate
            else if (!res.ok) throw new Error('Telemetry update failed: HTTP ' + res.status);
        }
        if (!state.fileId) {
            state.sharedWith = [];
            var existing = await findOwnFile(name);
            if (existing) {
                state.fileId = existing;
                if (!(await patchContent(existing, body)).ok) throw new Error('Telemetry update failed');
            } else {
                state.fileId = await createFile(name, body);
            }
        }
        state.sharedWith = await shareWithAdmins(state.fileId, cfg.editorEmail, state.sharedWith);
        state.lastFlush = new Date().toISOString();
        saveState(state);
    }

    /** Upload the current snapshot. Never throws; concurrent calls coalesce into one follow-up. */
    function flush() {
        if (flushing) { flushQueued = true; return flushing; }
        flushing = doFlush()
            .catch(function (e) { originalWarn('[Telemetry] flush failed: ' + (e && e.message)); })
            .then(function () {
                flushing = null;
                if (flushQueued) { flushQueued = false; return flush(); }
            });
        return flushing;
    }

    function noteUpdate(fields) {
        Object.keys(fields || {}).forEach(function (k) { updateInfo[k] = fields[k]; });
        flush();
    }

    /** Called from main.js's console.error hook. Uploads at most once per 2 minutes. */
    function noteError(message) {
        lastError = new Date().toISOString() + ' ' + String(message).slice(0, 1000);
        var now = Date.now();
        if (now - lastErrorFlush > 2 * 60 * 1000) {
            lastErrorFlush = now;
            setTimeout(flush, 1000);
        }
    }

    var heartbeat = null;
    function start() {
        flush();
        if (!heartbeat) heartbeat = setInterval(flush, 30 * 60 * 1000);
    }

    /* ---------------- admin side ---------------- */

    async function isCurrentUserAdmin() {
        var cfg = (typeof Config !== 'undefined' && Config.data) || {};
        return isAdminEmail(cfg.editorEmail, adminEmails());
    }

    /** All telemetry files visible to the admin (their own + every one shared with them). */
    async function listEditors() {
        var q = "appProperties has { key='" + MARKER_KEY + "' and value='1' } and trashed=false";
        var res = await driveFetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
            '&fields=files(id,name,modifiedTime,owners(emailAddress,displayName))&pageSize=200');
        if (!res.ok) throw new Error('Could not list editors: HTTP ' + res.status);
        var files = (await res.json()).files || [];
        var out = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            try {
                var r = await driveFetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var snap = JSON.parse(await r.text());
                snap._fileId = f.id;
                snap._modifiedTime = f.modifiedTime;
                out.push(snap);
            } catch (e) {
                var owner = (f.owners && f.owners[0]) || {};
                out.push({ email: owner.emailAddress || f.name, name: owner.displayName || '', _fileId: f.id,
                    _modifiedTime: f.modifiedTime, _readError: e.message, log: [] });
            }
        }
        out.sort(function (a, b) { return String(b.lastSeen || b._modifiedTime).localeCompare(String(a.lastSeen || a._modifiedTime)); });
        return out;
    }

    var Telemetry = {
        MARKER_KEY: MARKER_KEY,
        MAX_LOG_LINES: MAX_LOG_LINES,
        redact: redact,
        trimLog: trimLog,
        telemetryFileName: telemetryFileName,
        isAdminEmail: isAdminEmail,
        buildSnapshot: buildSnapshot,
        flush: flush,
        start: start,
        noteUpdate: noteUpdate,
        noteError: noteError,
        isCurrentUserAdmin: isCurrentUserAdmin,
        listEditors: listEditors
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Telemetry;
    if (typeof window !== 'undefined') window.Telemetry = Telemetry;
    else if (typeof globalThis !== 'undefined') globalThis.Telemetry = Telemetry;
})();
