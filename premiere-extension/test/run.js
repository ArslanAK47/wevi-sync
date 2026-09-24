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

/* ---------------- jsx-escape ---------------- */
section('jsx-escape');
const JsxEscape = require('../client/js/jsx-escape.js');
// ExtendScript parses string literals like ES3 JS, so a JS eval of the literal
// proves the host function receives exactly the original value.
const evalLiteral = (lit) => (0, eval)('(' + lit + ')');

test('round-trips awkward Windows paths', () => {
    [
        "E:\\Projects\\John's Edit\\final.prproj",
        'C:\\Users\\me\\Desktop\\new\\test\\x.mp4',
        "D:\\a'b\\c\\\\d",
        'E:\\clips\\"quoted"\\line\nbreak\r' + String.fromCharCode(0x2028, 0x2029),
        'E:\\Shoots\\2028\\2029-final\\u2028.mov',
        ''
    ].forEach(p => assert.strictEqual(evalLiteral(JsxEscape.jsxString(p)), p));
});

test('JSON payloads survive (AE comp names / relink mappings)', () => {
    const comps = ["Main Comp", 'Title "v2"', "Kid's \\ intro"];
    const back = evalLiteral(JsxEscape.jsxString(JSON.stringify(comps)));
    assert.deepStrictEqual(JSON.parse(back), comps);
});

test('null/undefined become empty string', () => {
    assert.strictEqual(JsxEscape.jsxString(null), "''");
    assert.strictEqual(JsxEscape.jsxString(undefined), "''");
});

test('no evalScript call hand-quotes an interpolated value', () => {
    const jsDir = path.join(__dirname, '..', 'client', 'js');
    fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).forEach(f => {
        fs.readFileSync(path.join(jsDir, f), 'utf8').split('\n').forEach((line, i) => {
            if (/evalScript\(\s*`[^`]*'\$\{/.test(line)) {
                throw new Error(`${f}:${i + 1} builds '\${...}' by hand — use JsxEscape.jsxString()`);
            }
        });
    });
});

/* ---------------- ae-manifest (push side) ---------------- */
section('ae-manifest');

test('footage already queued for upload still lands in the .aep manifest list', () => {
    const byAep = {};
    const seen = new Set(['D:\\Shoot\\clip.mov']); // also used on the Premiere timeline
    ['D:\\Shoot\\clip.mov', 'D:\\Shoot\\logo.png'].forEach(p => DrivePaths.addAeFootage(byAep, 'E:\\p\\fx.aep', p));
    assert.ok(seen.has('D:\\Shoot\\clip.mov'));
    assert.deepStrictEqual(byAep['E:\\p\\fx.aep'], ['D:\\Shoot\\clip.mov', 'D:\\Shoot\\logo.png']);
});

test('one clip used by two .aep files is listed for both; dupes ignored case-insensitively', () => {
    const byAep = {};
    DrivePaths.addAeFootage(byAep, 'A.aep', 'D:\\Shoot\\clip.mov');
    DrivePaths.addAeFootage(byAep, 'A.aep', 'd:/shoot/CLIP.mov');
    DrivePaths.addAeFootage(byAep, 'B.aep', 'D:\\Shoot\\clip.mov');
    assert.strictEqual(byAep['A.aep'].length, 1);
    assert.strictEqual(byAep['B.aep'].length, 1);
});

/* ---------------- ae-relink script (runs inside After Effects) ---------------- */
section('ae-relink');
const vm = require('vm');
const hostCtx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'host', 'index.jsx'), 'utf8'), hostCtx);

// Minimal After Effects object model: just what the relink script touches.
function runAeRelink(maps, items, existing) {
    const norm = p => String(p).replace(/\\/g, '/').toLowerCase();
    const onDisk = new Set(existing.map(norm));
    const log = { saved: false, opened: null, replaced: {}, sequences: {} };
    class File { constructor(p) { this.fsName = String(p).replace(/\//g, '\\'); this.exists = onDisk.has(norm(p)); } }
    class FileSource { constructor(o) { Object.assign(this, o); } }
    class SolidSource { }
    class FootageItem {
        constructor(o) { Object.assign(this, o); }
        replace(f) { log.replaced[this.name] = f.fsName; }
        replaceWithSequence(f) { log.sequences[this.name] = f.fsName; }
    }
    const project = {
        file: null,
        get numItems() { return items.length; },
        item(i) { return items[i - 1]; },
        save() { log.saved = true; }
    };
    const ctx = vm.createContext({
        File, FileSource, SolidSource, FootageItem,
        app: { project, open(f) { log.opened = f.fsName; }, activate() { } }
    });
    // Build items with the context's classes so instanceof works inside the script.
    items = items.map(fn => fn(ctx));
    const script = hostCtx.buildAeRelinkScript('E:\\Pulled\\John\'s FX.aep', maps);
    const out = vm.runInContext(script, ctx).split('|');
    return { log, status: out[0], relinked: +out[1], failed: +out[2], scanned: +out[3], missing: +out[4], unmatched: +out[5], raw: out };
}

test('relinks MISSING footage (file is null, path only in missingFootagePath)', () => {
    const r = runAeRelink(
        [{ o: 'D:\\Shoot\\clip A.mov', n: 'E:\\Pulled\\external_d\\Shoot\\clip A.mov' }],
        [c => new c.FootageItem({ name: 'clip A.mov', file: null, footageMissing: true,
            mainSource: new c.FileSource({ missingFootagePath: 'D:\\Shoot\\clip A.mov', isStill: false }) })],
        ['E:\\Pulled\\external_d\\Shoot\\clip A.mov']);
    assert.strictEqual(r.status, 'OK', r.raw.join('|'));
    assert.strictEqual(r.relinked, 1);
    assert.strictEqual(r.missing, 1);
    assert.strictEqual(r.log.replaced['clip A.mov'], 'E:\\Pulled\\external_d\\Shoot\\clip A.mov');
    assert.ok(r.log.saved, 'project saved after relink');
    assert.strictEqual(r.log.opened, "E:\\Pulled\\John's FX.aep");
});

test('basename fallback, name fallback, sequences, solids, unmatched, already-linked', () => {
    const r = runAeRelink(
        [
            { o: 'C:\\Other\\Place\\logo.png', n: 'E:\\Pulled\\logo.png' },
            { o: 'D:\\x\\bg.mov', n: 'E:\\Pulled\\bg.mov' },
            { o: 'D:\\x\\seq_0001.png', n: 'E:\\Pulled\\seq\\seq_0001.png' },
            { o: 'D:\\x\\ok.mov', n: 'E:\\Pulled\\ok.mov' },
            { o: 'D:\\x\\gone.mov', n: 'E:\\Pulled\\gone.mov' }
        ],
        [
            // different folder than the manifest -> basename match
            c => new c.FootageItem({ name: 'logo.png', file: null, footageMissing: true,
                mainSource: new c.FileSource({ missingFootagePath: 'Z:\\old\\logo.png', isStill: true }) }),
            // no path at all -> item name match
            c => new c.FootageItem({ name: 'bg.mov', file: null, footageMissing: true,
                mainSource: new c.FileSource({ missingFootagePath: '', isStill: false }) }),
            // image sequence
            c => new c.FootageItem({ name: 'seq_[0001-0100].png', file: null, footageMissing: true,
                mainSource: new c.FileSource({ missingFootagePath: 'D:\\x\\seq_0001.png', isStill: false }) }),
            // solid -> ignored entirely
            c => new c.FootageItem({ name: 'Black Solid 1', file: null, footageMissing: false, mainSource: new c.SolidSource() }),
            // not in manifest -> unmatched
            c => new c.FootageItem({ name: 'stranger.mov', file: null, footageMissing: true,
                mainSource: new c.FileSource({ missingFootagePath: 'D:\\x\\stranger.mov', isStill: false }) }),
            // already linked to the target -> untouched
            c => new c.FootageItem({ name: 'ok.mov', file: new c.File('E:\\Pulled\\ok.mov'), footageMissing: false,
                mainSource: new c.FileSource({ isStill: false }) }),
            // matched but the file never downloaded -> failed
            c => new c.FootageItem({ name: 'gone.mov', file: null, footageMissing: true,
                mainSource: new c.FileSource({ missingFootagePath: 'D:\\x\\gone.mov', isStill: false }) })
        ],
        ['E:\\Pulled\\logo.png', 'E:\\Pulled\\bg.mov', 'E:\\Pulled\\seq\\seq_0001.png', 'E:\\Pulled\\ok.mov']);
    assert.strictEqual(r.status, 'OK', r.raw.join('|'));
    assert.strictEqual(r.log.replaced['logo.png'], 'E:\\Pulled\\logo.png');
    assert.strictEqual(r.log.replaced['bg.mov'], 'E:\\Pulled\\bg.mov');
    assert.strictEqual(r.log.sequences['seq_[0001-0100].png'], 'E:\\Pulled\\seq\\seq_0001.png');
    assert.strictEqual(r.log.replaced['ok.mov'], undefined);
    assert.deepStrictEqual(
        { relinked: r.relinked, failed: r.failed, scanned: r.scanned, missing: r.missing, unmatched: r.unmatched },
        { relinked: 3, failed: 1, scanned: 6, missing: 5, unmatched: 1 });
});

test('nothing missing -> no relink and no save', () => {
    const r = runAeRelink(
        [{ o: 'D:\\x\\ok.mov', n: 'E:\\Pulled\\ok.mov' }],
        [c => new c.FootageItem({ name: 'ok.mov', file: new c.File('E:\\Pulled\\ok.mov'), footageMissing: false,
            mainSource: new c.FileSource({ isStill: false }) })],
        ['E:\\Pulled\\ok.mov']);
    assert.deepStrictEqual([r.relinked, r.missing, r.log.saved], [0, 0, false]);
});

/* ---------------- sync folder validation ---------------- */
section('sync-folder');
const exists = p => !/missing/i.test(p);

test('"E/Pr projects" (lost colon) is rejected with the E:\\ fix suggested', () => {
    const r = DrivePaths.checkSyncFolderPath('E/Pr projects', exists);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.suggestion, 'E:\\Pr projects');
});

test('valid drive paths normalise slashes, quotes and trailing separators', () => {
    assert.deepStrictEqual(DrivePaths.checkSyncFolderPath('E:\\Pr projects', exists), { ok: true, path: 'E:\\Pr projects' });
    assert.strictEqual(DrivePaths.checkSyncFolderPath('E:/Pr projects/', exists).path, 'E:\\Pr projects');
    assert.strictEqual(DrivePaths.checkSyncFolderPath('"E:\\Pr projects"', exists).path, 'E:\\Pr projects');
    assert.strictEqual(DrivePaths.checkSyncFolderPath('E:', exists).path, 'E:\\');
    assert.strictEqual(DrivePaths.checkSyncFolderPath('\\\\nas\\share\\edits', exists).path, '\\\\nas\\share\\edits');
});

test('relative, empty and non-existent folders are rejected', () => {
    assert.strictEqual(DrivePaths.checkSyncFolderPath('Pr projects', exists).ok, false);
    assert.strictEqual(DrivePaths.checkSyncFolderPath('', exists).ok, false);
    assert.match(DrivePaths.checkSyncFolderPath('C:\\Missing', exists).error, /does not exist/);
});

/* ---------------- update-core (auto-updater) ---------------- */
section('update-core');
const UpdateCore = require('../client/js/update-core.js');
const crypto = require('crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('compareVersions', () => {
    assert.strictEqual(UpdateCore.compareVersions('1.5.4', '1.5.3'), 1);
    assert.strictEqual(UpdateCore.compareVersions('1.5.3', '1.5.3'), 0);
    assert.strictEqual(UpdateCore.compareVersions('1.4.9', '1.5.0'), -1);
    assert.strictEqual(UpdateCore.compareVersions('1.6.10', '1.6.9'), 1);
});

test('bumpVersion patch/minor/major/explicit', () => {
    assert.strictEqual(UpdateCore.bumpVersion('1.6.3', 'patch'), '1.6.4');
    assert.strictEqual(UpdateCore.bumpVersion('1.6.3', 'minor'), '1.7.0');
    assert.strictEqual(UpdateCore.bumpVersion('1.6.3', 'major'), '2.0.0');
    assert.strictEqual(UpdateCore.bumpVersion('1.6.3', '1.9.0'), '1.9.0');
    assert.throws(() => UpdateCore.bumpVersion('1.6.3', 'huge'));
});

test('parseManifest accepts valid, drops reserved files', () => {
    const files = UpdateCore.parseManifest({ files: [
        { path: 'client/js/main.js', size: 3, sha256: sha('abc') },
        { path: 'version.json', size: 1, sha256: sha('x') }
    ] });
    assert.deepStrictEqual(files.map(f => f.path), ['client/js/main.js']);
});

test('parseManifest rejects path traversal, absolute and backslash paths', () => {
    for (const bad of ['../evil.js', '/abs.js', 'C:/x.js', 'client\\x.js', 'a//b.js', 'a/./b.js']) {
        assert.throws(() => UpdateCore.parseManifest({ files: [{ path: bad, size: 1, sha256: sha('a') }] }), /unsafe/, bad);
    }
});

test('parseManifest rejects missing hashes, duplicates and empty lists', () => {
    assert.throws(() => UpdateCore.parseManifest({ files: [{ path: 'a.js', size: 1 }] }), /sha256/);
    assert.throws(() => UpdateCore.parseManifest({ files: [
        { path: 'a.js', size: 1, sha256: sha('a') }, { path: 'a.js', size: 1, sha256: sha('a') }] }), /twice/);
    assert.throws(() => UpdateCore.parseManifest({ files: [] }), /no files/);
    assert.throws(() => UpdateCore.parseManifest(null), /malformed/);
});

test('verifyEntry catches size and checksum mismatches', () => {
    const e = { path: 'a.js', size: 3, sha256: sha('abc') };
    assert.strictEqual(UpdateCore.verifyEntry(e, 3, sha('abc')), null);
    assert.match(UpdateCore.verifyEntry(e, 4, sha('abcd')), /size/);
    assert.match(UpdateCore.verifyEntry(e, 3, sha('abd')), /checksum/);
});

test('removedPaths only deletes files we shipped before', () => {
    const oldE = [{ path: 'client/js/old.js' }, { path: 'client/js/main.js' }, { path: 'version.json' }];
    const newE = [{ path: 'client/js/main.js' }];
    assert.deepStrictEqual(UpdateCore.removedPaths(oldE, newE), ['client/js/old.js']);
    assert.deepStrictEqual(UpdateCore.removedPaths([], newE), []);
});

test('hostFilesChanged flags ExtendScript/manifest changes only', () => {
    assert.strictEqual(UpdateCore.hostFilesChanged([{ path: 'client/js/main.js' }]), false);
    assert.strictEqual(UpdateCore.hostFilesChanged([{ path: 'host/index.jsx' }]), true);
});

test('committed dist/ matches its files.json (what editors will download)', () => {
    const distExt = path.join(__dirname, '..', '..', 'dist', 'premiere-extension');
    const mf = path.join(distExt, 'files.json');
    if (!fs.existsSync(mf)) return; // first release creates it
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const entries = UpdateCore.parseManifest(manifest);
    for (const e of entries) {
        const buf = fs.readFileSync(path.join(distExt, e.path));
        assert.strictEqual(UpdateCore.verifyEntry(e, buf.length, sha(buf)), null, e.path);
    }
    const distVersion = JSON.parse(fs.readFileSync(path.join(distExt, 'version.json'), 'utf8')).version;
    assert.strictEqual(manifest.version, distVersion, 'files.json version matches dist version.json');
});

/* ---------------- telemetry (admin view) ---------------- */
section('telemetry');
const Telemetry = require('../client/js/telemetry.js');

test('redact strips OAuth tokens, secrets and auth headers', () => {
    const raw = [
        'Authorization: Bearer ya29.a0AfH6SMBx-abc_def',
        '{"access_token":"ya29.zzz","refresh_token":"1//0gAbCdEfGhIjKlMnOpQrStUv","expires_in":3599}',
        'POST body client_secret=GOCSPX-abcDEF123_x&code=4/0AbcDef&grant_type=authorization_code',
        'https://oauth2.googleapis.com/revoke?token=ya29.qqq'
    ].join('\n');
    const out = Telemetry.redact(raw);
    assert.ok(!/ya29\./.test(out), out);
    assert.ok(!/GOCSPX-abc/.test(out), out);
    assert.ok(!/1\/\/0gAbCd/.test(out), out);
    assert.ok(!/code=4\//.test(out), out);
    assert.ok(/expires_in/.test(out), 'non-secret fields survive');
});

test('trimLog keeps the newest lines, clips giant ones, redacts', () => {
    const lines = [];
    for (let i = 0; i < 50; i++) lines.push('line ' + i);
    lines.push('x'.repeat(5000));
    lines.push('Bearer ya29.secret');
    const out = Telemetry.trimLog(lines, 10);
    assert.strictEqual(out.length, 10);
    assert.strictEqual(out[0], 'line 42');
    assert.ok(out[8].length < 2100 && /clipped/.test(out[8]));
    assert.strictEqual(out[9], 'Bearer [REDACTED]');
});

test('buildSnapshot shape + redacted lastError', () => {
    const snap = Telemetry.buildSnapshot({ email: 'ed@x.com', extensionVersion: '1.7.0', lastError: 'Bearer ya29.abc failed', log: ['a'], now: '2026-01-01T00:00:00Z' });
    assert.strictEqual(snap.schema, 1);
    assert.strictEqual(snap.email, 'ed@x.com');
    assert.strictEqual(snap.extensionVersion, '1.7.0');
    assert.strictEqual(snap.lastSeen, '2026-01-01T00:00:00Z');
    assert.ok(!/ya29/.test(snap.lastError));
    assert.deepStrictEqual(snap.log, ['a']);
});

test('isAdminEmail is case/space-insensitive and rejects empty', () => {
    assert.strictEqual(Telemetry.isAdminEmail(' Boss@Gmail.com ', ['boss@gmail.com']), true);
    assert.strictEqual(Telemetry.isAdminEmail('editor@gmail.com', ['boss@gmail.com']), false);
    assert.strictEqual(Telemetry.isAdminEmail('', ['']), false);
});

test('telemetryFileName is stable and filesystem-safe', () => {
    assert.strictEqual(Telemetry.telemetryFileName('Ed.One+x@Gmail.com'), 'TeamSync-Telemetry-ed.one_x@gmail.com.json');
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
