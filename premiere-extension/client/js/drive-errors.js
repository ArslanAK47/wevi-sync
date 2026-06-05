/* ============================================
   DRIVE ERROR DESCRIBER (pure, Node-exportable)
   --------------------------------------------
   Turns a Drive/HTTP failure into a non-empty,
   actionable message so pushes never report
   "failed" with no reason. Used at every Drive
   throw site.
   ============================================ */
(function () {
    'use strict';

    function parseBody(bodyText) {
        if (!bodyText) return null;
        if (typeof bodyText === 'object') return bodyText;
        try { return JSON.parse(bodyText); } catch (e) { return null; }
    }

    function hintFor(status) {
        switch (Number(status)) {
            case 401: return 'Your Google sign-in expired — reconnect Google Drive and try again.';
            case 403: return 'Permission/quota issue — check Drive access to the team folder, or you may have hit a rate limit.';
            case 404: return 'The target file or folder was not found on Drive (it may have been moved or deleted).';
            case 409: return 'A conflicting change exists on Drive — pull the latest version first.';
            case 429: return 'Google Drive rate limit reached — wait a moment and retry.';
            case 500:
            case 502:
            case 503:
            case 504: return 'Google Drive had a temporary server error — retrying usually fixes it.';
            case 0: return 'Network problem — check your internet connection.';
            default: return '';
        }
    }

    /**
     * @param {number} status      HTTP status (0 for network failure)
     * @param {string} statusText  HTTP status text (optional)
     * @param {string|object} bodyText  response body (JSON string or object)
     * @param {string} context     what we were doing, e.g. "uploading clip.mp4"
     * @returns {string} always non-empty
     */
    function describeDriveError(status, statusText, bodyText, context) {
        var parts = [];
        if (context) parts.push(context + ' failed');

        var body = parseBody(bodyText);
        var apiMsg = '';
        var reason = '';
        if (body && body.error) {
            if (typeof body.error === 'string') {
                apiMsg = body.error_description || body.error;
            } else {
                apiMsg = body.error.message || '';
                if (body.error.errors && body.error.errors.length) {
                    reason = body.error.errors[0].reason || '';
                }
            }
        }

        var httpPart = '';
        if (status) {
            httpPart = 'HTTP ' + status + (statusText ? ' ' + statusText : '');
        } else {
            httpPart = 'network error';
        }
        parts.push(httpPart);

        if (apiMsg) parts.push(apiMsg);
        if (reason && reason !== apiMsg) parts.push('(' + reason + ')');

        var hint = hintFor(status);
        var msg = parts.filter(Boolean).join(': ');
        if (hint) msg += ' — ' + hint;
        return msg || 'Unknown Drive error';
    }

    var DriveErrors = { describeDriveError: describeDriveError, hintFor: hintFor };
    if (typeof module !== 'undefined' && module.exports) module.exports = DriveErrors;
    if (typeof window !== 'undefined') window.DriveErrors = DriveErrors;
    else if (typeof globalThis !== 'undefined') globalThis.DriveErrors = DriveErrors;
})();
