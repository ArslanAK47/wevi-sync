/* Load-smoke test: evaluate every panel script (in index.html order) inside a
   stubbed browser/CEP environment to catch LOAD-TIME crashes — the kind that
   would white-screen the panel for every editor after an auto-update.
   It does NOT exercise UI behavior; it only proves the scripts load and wire up
   their globals without throwing. Run: node premiere-extension/test/load-smoke.js */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const jsDir = path.join(__dirname, '..', 'client', 'js');

// Scripts in the exact order index.html loads them (CSInterface is stubbed below).
const ORDER = [
    'config.js', 'google-config.js', 'drive-errors.js', 'project-id.js', 'drive-paths.js',
    'google-drive.js', 'sync.js', 'upload-helper.js', 'download-helper.js', 'upload-xhr.js',
    'update-checker.js', 'main.js'
];

function fakeEl() {
    const el = {
        style: {}, value: '', textContent: '', innerHTML: '', className: '', dataset: {},
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, removeEventListener() {}, focus() {}, click() {}, select() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        scrollTop: 0, scrollHeight: 0, disabled: false, checked: false
    };
    return el;
}

const documentStub = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return fakeEl(); },
    addEventListener() {},
    head: fakeEl(),
    body: fakeEl()
};

const localStorageStub = (() => {
    const store = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; }
    };
})();

const sandbox = {
    console, require, module: undefined, process,
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    document: documentStub,
    localStorage: localStorageStub,
    navigator: { userAgent: 'smoke', platform: 'Win32' },
    location: { pathname: '/C:/ext/client/index.html', href: 'file:///C:/ext/client/index.html' },
    fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }); },
    XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {}, upload: { addEventListener() {} } }; },
    TextEncoder, TextDecoder, Buffer, URL, URLSearchParams,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    CSInterface: function () {
        return {
            getSystemPath() { return 'C:/ext'; },
            evalScript(s, cb) { if (cb) cb('{}'); },
            resizeContent() {}, addEventListener() {}
        };
    }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

let ok = true;

// Pass 1: load each file separately to isolate any load-time throw to a file.
for (const file of ORDER) {
    const full = path.join(jsDir, file);
    let code;
    try { code = fs.readFileSync(full, 'utf8'); }
    catch (e) { console.error('MISSING: ' + file); ok = false; continue; }
    try {
        vm.runInContext(code, sandbox, { filename: file });
        process.stdout.write('.');
    } catch (e) {
        ok = false;
        console.error(`\nLOAD ERROR in ${file}: ${e && e.message}`);
        if (e && e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
    }
}
process.stdout.write('\n');

// Pass 2: load all files as ONE script (like the browser sharing global scope) so we
// can verify the top-level const-declared globals are present and wired.
const sandbox2 = Object.assign({}, sandbox);
sandbox2.window = sandbox2; sandbox2.globalThis = sandbox2; sandbox2.self = sandbox2;
sandbox2.document = documentStub; sandbox2.localStorage = localStorageStub;
vm.createContext(sandbox2);
const epilogue = `
window.__present = {
  Config: typeof Config, GoogleDriveConfig: typeof GoogleDriveConfig,
  DriveErrors: typeof DriveErrors, ProjectId: typeof ProjectId, DrivePaths: typeof DrivePaths,
  GoogleDrive: typeof GoogleDrive, SyncEngine: typeof SyncEngine, FileSystem: typeof FileSystem,
  resolveProjectFolder: (typeof GoogleDrive!=='undefined') && typeof GoogleDrive.resolveProjectFolder,
  writeLock: (typeof GoogleDrive!=='undefined') && typeof GoogleDrive.writeLock,
  findProjectFolder: (typeof GoogleDrive!=='undefined') && typeof GoogleDrive.findProjectFolder,
  relinkAe: (typeof FileSystem!=='undefined') && typeof FileSystem.relinkAeFootage,
  saveProject: (typeof FileSystem!=='undefined') && typeof FileSystem.saveProject
};`;
try {
    const combined = ORDER.map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n;\n') + epilogue;
    vm.runInContext(combined, sandbox2, { filename: 'panel-combined.js' });
} catch (e) {
    ok = false;
    console.error('COMBINED LOAD ERROR: ' + (e && e.message));
}
const p = sandbox2.__present || {};
const mustBeObject = ['Config', 'GoogleDriveConfig', 'DriveErrors', 'ProjectId', 'DrivePaths', 'GoogleDrive', 'SyncEngine', 'FileSystem'];
for (const g of mustBeObject) {
    if (p[g] !== 'object' && p[g] !== 'function') { console.error('GLOBAL not wired: ' + g + ' (' + p[g] + ')'); ok = false; }
}
for (const fn of ['resolveProjectFolder', 'writeLock', 'findProjectFolder', 'relinkAe', 'saveProject']) {
    if (p[fn] !== 'function') { console.error('WIRING missing: ' + fn + ' (' + p[fn] + ')'); ok = false; }
}

console.log(ok ? 'LOAD SMOKE: OK (all panel scripts load cleanly + globals wired)' : 'LOAD SMOKE: FAILED');
process.exit(ok ? 0 : 1);
