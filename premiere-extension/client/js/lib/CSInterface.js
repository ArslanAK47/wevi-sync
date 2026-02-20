/**
 * CSInterface - Adobe CEP Interface
 * Simplified version for Premiere Pro extension
 */

function CSInterface() {
    this.hostEnvironment = {
        appName: 'PPRO',
        appVersion: '14.0'
    };
}

/**
 * Evaluate ExtendScript
 */
CSInterface.prototype.evalScript = function (script, callback) {
    try {
        // Check if we're in CEP environment
        if (typeof __adobe_cep__ !== 'undefined') {
            __adobe_cep__.evalScript(script, callback);
        } else {
            // Fallback for testing outside CEP
            console.log('CSInterface.evalScript (mock):', script);
            if (callback) callback(null);
        }
    } catch (e) {
        console.error('evalScript error:', e);
        if (callback) callback(null);
    }
};

/**
 * Get system path
 */
CSInterface.prototype.getSystemPath = function (pathType) {
    try {
        if (typeof __adobe_cep__ !== 'undefined') {
            return __adobe_cep__.getSystemPath(pathType);
        }
    } catch (e) {
        console.error('getSystemPath error:', e);
    }
    return '';
};

/**
 * Open URL in default browser
 */
CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    try {
        if (typeof cep !== 'undefined' && cep.util) {
            cep.util.openURLInDefaultBrowser(url);
        } else {
            window.open(url, '_blank');
        }
    } catch (e) {
        window.open(url, '_blank');
    }
};

/**
 * Get host environment info
 */
CSInterface.prototype.getHostEnvironment = function () {
    return this.hostEnvironment;
};

/**
 * System path constants
 */
CSInterface.prototype.SystemPath = {
    EXTENSION: 'extension',
    USER_DATA: 'userData',
    COMMON_FILES: 'commonFiles',
    HOST_APPLICATION: 'hostApplication'
};

// File/Folder classes for ExtendScript compatibility (used in evalScript)
if (typeof Folder === 'undefined') {
    window.Folder = {
        selectDialog: function (prompt) {
            // This is handled in evalScript
            return null;
        }
    };
}

if (typeof File === 'undefined') {
    window.File = {
        openDialog: function (prompt, filter) {
            // This is handled in evalScript
            return null;
        }
    };
}
