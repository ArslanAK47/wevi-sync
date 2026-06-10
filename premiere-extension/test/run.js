/* Zero-dependency test harness for the pure sync modules.
   Run: node premiere-extension/test/run.js
   Covers the logic that can be verified without Premiere/After Effects. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DrivePaths = require('../client/js/drive-paths.js');
const ProjectId = require('../client/js/project-id.js');
const DriveErrors = require('../client/js/drive-errors.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; process.stdout.write('.'); }
    catch (e) { failed++; failures.push({ name, err: e }); process.stdout.write('F'); }
}
function section(title) { process.stdout.write('\n' + title + ' '); }

/* ---------------- drive-paths ---------------- */
section('drive-paths');

test('project type -> basename only', () => {
    assert.strictEqual(
        DrivePaths.computeDriveRelativePath({ path: 'E:\\proj\\My Edit.prproj', type: 'project' }, 'E:\\proj', 'E:\\proj'),
        'My Edit.prproj');
});

test('project-internal media keeps relative tree', () => {
    assert.strictEqual(
        DrivePaths.computeDriveRelativePath({ path: 'E:\\proj\\media\\sub\\clip.mp4', type: 'video' }, 'E:\\proj', 'E:\\proj'),
        'media/sub/clip.mp4');
});

test('external media gets external_<drive> prefix', () => {
    assert.strictEqual(
        DrivePaths.computeDriveRelativePath({ path: 'D:\\assets\\v.mov', type: 'video' }, 'E:\\proj', 'E:\\proj'),
        'external_d/assets/v.mov');
});

test('AE footage yields a real relative path (no [AE] prefix)', () => {
    const rel = DrivePaths.computeDriveRelativePath(
        { path: 'E:\\proj\\footage\\clip.mp4', type: 'video' }, 'E:\\proj', 'E:\\proj');
    assert.strictEqual(rel.indexOf('[AE]'), -1);
    assert.strictEqual(rel, 'footage/clip.mp4');
});

test('AE manifest path parity with uploader', () => {
    const projectRoot = 'E:\\proj';
    const footage = [{ path: 'E:\\proj\\footage\\clip.mp4', name: 'clip.mp4' }];
    const manifest = DrivePaths.buildAeRelinkManifest({ path: 'E:\\proj\\comp.aep' }, footage, projectRoot, projectRoot);
    const uploaderPath = DrivePaths.computeDriveRelativePath(
        { path: footage[0].path, type: 'video' }, projectRoot, projectRoot);
    assert.strictEqual(manifest.footage[0].driveRelativePath, uploaderPath);
    assert.strictEqual(manifest.aepDriveRelativePath, 'comp.aep');
    assert.strictEqual(manifest.footage[0].basename, 'clip.mp4');
});

test('chooseRelinkTarget: unique basename', () => {
    const idx = DrivePaths.buildRelinkIndex(['media/clip.mp4', 'audio/song.wav']);
    assert.strictEqual(DrivePaths.chooseRelinkTarget('D:\\old\\clip.mp4', idx), 'media/clip.mp4');
});

test('chooseRelinkTarget: duplicate basenames disambiguated by trailing path', () => {
    const idx = DrivePaths.buildRelinkIndex(['a/intro.mp4', 'b/intro.mp4']);
    assert.strictEqual(DrivePaths.chooseRelinkTarget('E:\\proj\\b\\intro.mp4', idx), 'b/intro.mp4');
});

test('chooseRelinkTarget: ambiguous -> null', () => {
    const idx = DrivePaths.buildRelinkIndex(['x/intro.mp4', 'y/intro.mp4']);
    assert.strictEqual(DrivePaths.chooseRelinkTarget('Z:\\nowhere\\intro.mp4', idx), null);
});

test('chooseRelinkTarget: missing -> null', () => {
    const idx = DrivePaths.buildRelinkIndex(['media/clip.mp4']);
    assert.strictEqual(DrivePaths.chooseRelinkTarget('D:\\old\\other.mp4', idx), null);
});

test('resolveRelinkMappings: exact relative hit', () => {
    const manifest = {
        footage: [{ originalPath: 'E:\\proj\\footage\\clip.mp4', driveRelativePath: 'footage/clip.mp4', basename: 'clip.mp4' }]
    };
    const maps = DrivePaths.resolveRelinkMappings(manifest, 'C:\\sync\\My Edit', ['footage/clip.mp4']);
    assert.strictEqual(maps[0].oldPath, 'E:\\proj\\footage\\clip.mp4');
    assert.strictEqual(maps[0].newPath, 'C:\\sync\\My Edit\\footage\\clip.mp4');
    assert.strictEqual(maps[0].resolved, true);
});

/* ---------------- project-id ---------------- */
section('project-id');

test('computeCleanName strips .prproj', () => {
    assert.strictEqual(ProjectId.computeCleanName('E:\\a\\b\\Promo Final.prproj'), 'Promo Final');
});

test('generateProjectId deterministic with injected rng/clock', () => {
    const opts = { rng: () => 'deadbeefdeadbeef', createdAt: '2026-01-01T00:00:00.000Z' };
    const a = ProjectId.generateProjectId('Promo', opts);
    const b = ProjectId.generateProjectId('Promo', opts);
    assert.strictEqual(a, b);
    assert.ok(ProjectId.isValidId(a), 'id should be 16 hex: ' + a);
});

test('driveFolderName / parseDriveFolderName round-trip', () => {
    const id = 'a1b2c3d4e5f6a7b8';
    const name = ProjectId.driveFolderName('Promo', id);
    assert.strictEqual(name, 'Promo__' + id);
    const parsed = ProjectId.parseDriveFolderName(name);
    assert.strictEqual(parsed.cleanName, 'Promo');
    assert.strictEqual(parsed.projectId, id);
});

test('parseDriveFolderName: legacy plain name', () => {
    const parsed = ProjectId.parseDriveFolderName('Promo');
    assert.strictEqual(parsed.cleanName, 'Promo');
    assert.strictEqual(parsed.projectId, null);
});

test('parseDriveFolderName: malformed __ suffix treated as legacy', () => {
    const parsed = ProjectId.parseDriveFolderName('My__Project');
    assert.strictEqual(parsed.projectId, null);
    assert.strictEqual(parsed.cleanName, 'My__Project');
});

test('loadOrCreateSidecar: creates then loads stable id (temp dir)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wevi-'));
    const prproj = path.join(dir, 'Edit.prproj');
    fs.writeFileSync(prproj, 'x');
    const first = ProjectId.loadOrCreateSidecar(prproj, fs, { createdBy: 'me@x.com' });
    assert.strictEqual(first.created, true);
    ProjectId.writeSidecar(first.sidecarPath, first.sidecarObject, fs);
    const second = ProjectId.loadOrCreateSidecar(prproj, fs);
    assert.strictEqual(second.created, false);
    assert.strictEqual(second.projectId, first.projectId);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('decideProjectFolderAction: exact / byId / adopt / create', () => {
    const id = 'a1b2c3d4e5f6a7b8';
    const canonical = 'Promo__' + id;
    assert.strictEqual(ProjectId.decideProjectFolderAction([{ id: '1', name: canonical }], 'Promo', id).action, 'exact');
    assert.strictEqual(ProjectId.decideProjectFolderAction([{ id: '2', name: 'Renamed__' + id }], 'Promo', id).action, 'byId');
    const adopt = ProjectId.decideProjectFolderAction([{ id: '3', name: 'Promo' }], 'Promo', id);
    assert.strictEqual(adopt.action, 'adopt');
    assert.strictEqual(adopt.name, canonical);
    assert.strictEqual(ProjectId.decideProjectFolderAction([{ id: '4', name: 'Other' }], 'Promo', id).action, 'create');
});

test('two same-name projects get different folders', () => {
    const idA = ProjectId.generateProjectId('Promo', { rng: () => '1111111111111111', createdAt: 'a' });
    const idB = ProjectId.generateProjectId('Promo', { rng: () => '2222222222222222', createdAt: 'b' });
    assert.notStrictEqual(idA, idB);
    assert.notStrictEqual(ProjectId.driveFolderName('Promo', idA), ProjectId.driveFolderName('Promo', idB));
});

/* ---------------- conflict + locks ---------------- */
section('conflict+locks');

test('detectConflict: first push', () => {
    assert.strictEqual(ProjectId.detectConflict(null, { md5: 'x' }).conflict, false);
});
test('detectConflict: unchanged (md5 match)', () => {
    assert.strictEqual(ProjectId.detectConflict({ md5: 'x' }, { md5: 'x' }).conflict, false);
});
test('detectConflict: remote changed by other user', () => {
    const r = ProjectId.detectConflict(
        { md5: 'x', modifiedTime: '2026-01-01T00:00:00Z' },
        { md5: 'y', modifiedTime: '2026-02-01T00:00:00Z', lastModifyingUser: { displayName: 'Sarah' } });
    assert.strictEqual(r.conflict, true);
    assert.strictEqual(r.who, 'Sarah');
});

test('isStaleLock', () => {
    const now = Date.parse('2026-06-04T12:00:00Z');
    assert.strictEqual(ProjectId.isStaleLock({ lockedAt: '2026-06-04T00:00:00Z' }, now, 8 * 3600 * 1000), true);
    assert.strictEqual(ProjectId.isStaleLock({ lockedAt: '2026-06-04T11:00:00Z' }, now, 8 * 3600 * 1000), false);
});
test('canUnlock owner only', () => {
    assert.strictEqual(ProjectId.canUnlock({ email: 'a@x.com' }, 'a@x.com'), true);
    assert.strictEqual(ProjectId.canUnlock({ email: 'a@x.com' }, 'b@x.com'), false);
});
test('locksToRenderShape maps to {project_name, locked_by}', () => {
    const shape = ProjectId.locksToRenderShape(
        [{ cleanName: 'Promo', lock: { lockedBy: 'Sarah', email: 's@x.com', lockedAt: '2026-06-04T11:59:00Z' } }],
        Date.parse('2026-06-04T12:00:00Z'));
    assert.strictEqual(shape[0].project_name, 'Promo');
    assert.strictEqual(shape[0].locked_by, 'Sarah');
    assert.strictEqual(shape[0].stale, false);
});

/* ---------------- explorer status (v1.6.3) ---------------- */
section('explorer-status');

test('missing locally', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({ exists: false }), 'missing');
});
test('size match -> synced', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 100, driveSize: 100, remoteMd5: 'aaa', pullState: null
    }), 'synced');
});
test('patched .prproj (size differs, remote md5 unchanged, local untouched) -> synced', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 816040, driveSize: 816190, remoteMd5: 'aaa',
        pullState: { remoteMd5: 'aaa', localSize: 816040 }
    }), 'synced');
});
test('local edited since pull, remote unchanged -> localChanges', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 900000, driveSize: 816190, remoteMd5: 'aaa',
        pullState: { remoteMd5: 'aaa', localSize: 816040 }
    }), 'localChanges');
});
test('remote changed since pull -> modified', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 816040, driveSize: 820000, remoteMd5: 'bbb',
        pullState: { remoteMd5: 'aaa', localSize: 816040 }
    }), 'modified');
});
test('no pull state, size differs -> modified (legacy behavior)', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 1, driveSize: 2, remoteMd5: 'aaa', pullState: null
    }), 'modified');
});
test('drive folders have no md5 -> never falsely synced via pull state', () => {
    assert.strictEqual(DrivePaths.decideExplorerStatus({
        exists: true, localSize: 1, driveSize: 2, remoteMd5: null,
        pullState: { remoteMd5: '', localSize: 1 }
    }), 'modified');
});

/* ---------------- fork naming (v1.6.3) ---------------- */
section('fork-naming');

test('free name -> Project (editor)', () => {
    assert.strictEqual(ProjectId.suggestForkName('Promo', 'Fiazan', ['Promo']), 'Promo (Fiazan)');
});
test('email -> local part only', () => {
    assert.strictEqual(ProjectId.suggestForkName('Promo', 'fiazan011@gmail.com', []), 'Promo (fiazan011)');
});
test('taken -> counter suffix', () => {
    assert.strictEqual(
        ProjectId.suggestForkName('Promo', 'Fiazan', ['Promo', 'Promo (Fiazan)']),
        'Promo (Fiazan 2)');
    assert.strictEqual(
        ProjectId.suggestForkName('Promo', 'Fiazan', ['Promo', 'promo (fiazan)', 'Promo (Fiazan 2)']),
        'Promo (Fiazan 3)');
});
test('empty editor -> copy fallback', () => {
    assert.strictEqual(ProjectId.suggestForkName('Promo', '', []), 'Promo (copy)');
});
test('illegal chars sanitized', () => {
    const name = ProjectId.suggestForkName('Pro:mo?', 'Ed<it>or', []);
    assert.strictEqual(/[\\/:*?"<>|]/.test(name), false);
});

/* ---------------- drive-errors ---------------- */
section('drive-errors');

test('non-empty for empty body 403', () => {
    const msg = DriveErrors.describeDriveError(403, 'Forbidden', '', 'uploading clip.mp4');
    assert.ok(msg && msg.length > 10, msg);
    assert.ok(/403/.test(msg));
});
test('extracts Drive API error.message + reason', () => {
    const body = JSON.stringify({ error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } });
    const msg = DriveErrors.describeDriveError(429, 'Too Many Requests', body, 'creating folder');
    assert.ok(/Rate Limit Exceeded/.test(msg));
    assert.ok(/userRateLimitExceeded/.test(msg));
});
test('network error (status 0) is described', () => {
    const msg = DriveErrors.describeDriveError(0, '', '', 'uploading');
    assert.ok(/network/i.test(msg));
});

/* ---------------- version consistency ---------------- */
section('versions');

function readJson(p) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8')); }
test('three version.json agree on version/releaseDate/changelog', () => {
    const a = readJson('version.json');
    const b = readJson('../version.json');           // repo root
    const c = readJson('../dist/premiere-extension/version.json');
    ['version', 'releaseDate', 'changelog'].forEach(k => {
        assert.strictEqual(a[k], b[k], 'root differs on ' + k);
        assert.strictEqual(a[k], c[k], 'dist differs on ' + k);
    });
});

/* compareVersions copied-by-contract check (mirrors update-checker semantics) */
section('semver');
function compareVersions(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) { const na = pa[i] || 0, nb = pb[i] || 0; if (na > nb) return 1; if (na < nb) return -1; }
    return 0;
}
test('compareVersions', () => {
    assert.strictEqual(compareVersions('1.5.4', '1.5.3'), 1);
    assert.strictEqual(compareVersions('1.5.3', '1.5.3'), 0);
    assert.strictEqual(compareVersions('1.4.9', '1.5.0'), -1);
});

/* ---------------- summary ---------------- */
process.stdout.write('\n\n');
if (failed) {
    failures.forEach(f => {
        console.log('FAIL: ' + f.name);
        console.log('   ' + (f.err && f.err.message));
    });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
