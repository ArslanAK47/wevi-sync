#!/usr/bin/env node
/* One-command release for the Team Sync extension.

   release.bat patch "What changed, in plain words"
   release.bat minor "..."        release.bat 1.8.0 "..."

   1. runs the tests
   2. bumps premiere-extension/version.json
   3. builds dist/premiere-extension (+ files.json manifest with sha256 per file)
   4. mirrors version.json to the repo root (what every panel polls)
   5. rebuilds dist/TeamSync-Installer.zip
   6. commits, tags vX.Y.Z, pushes
   7. waits until GitHub serves the new version.json

   Flags:
     --dry-run     tests + build at the current version; no bump, no git
     --build-only  rebuild dist from the current version (used by build-dist.bat)
     --no-push     commit + tag locally, don't push
*/
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const UpdateCore = require('../premiere-extension/client/js/update-core.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'premiere-extension');
const DIST = path.join(ROOT, 'dist');
const DIST_EXT = path.join(DIST, 'premiere-extension');
const SRC_VERSION = path.join(SRC, 'version.json');
const ROOT_VERSION = path.join(ROOT, 'version.json');
const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/version.json';
const DOWNLOAD_URL = 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/dist/premiere-extension';

// What ships to editors. Everything else in premiere-extension/ (tests, docs, .debug) stays home.
const SHIP_DIRS = ['CSXS', 'client', 'host', 'icons'];
const NEVER_SHIP = new Set(['.debug', 'OAUTH_SETUP_STEPS.md', 'oauth-activation-html.txt', 'TESTING.md']);

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('\n✖ ' + msg + '\n'); process.exit(1); }

function git(args, opts) {
    return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {})).trim();
}

function parseArgs(argv) {
    const flags = new Set(argv.filter(a => a.startsWith('--')));
    const pos = argv.filter(a => !a.startsWith('--'));
    return {
        dryRun: flags.has('--dry-run'),
        buildOnly: flags.has('--build-only'),
        noPush: flags.has('--no-push'),
        bump: pos[0],
        changelog: pos.slice(1).join(' ').trim()
    };
}

function ask(question) {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

// v1.7.0 shipped with changelog "y" (a confirmation typed into the wrong prompt).
function changelogProblem(text) {
    const t = String(text || '').trim();
    if (!t) return 'Add a short changelog: editors see it on the update screen.';
    if (/^(y|yes|n|no|x|ok|test)$/i.test(t) || t.length < 8) return `"${t}" is too short for a changelog; describe what changed.`;
    return null;
}

function runTests() {
    log('▶ Running tests...');
    for (const t of ['test/run.js', 'test/load-smoke.js']) {
        try {
            execFileSync(process.execPath, [path.join(SRC, t)], { cwd: ROOT, stdio: 'pipe' });
        } catch (e) {
            process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
            fail(`Tests failed (${t}). Nothing was released.`);
        }
    }
    log('  ✓ tests pass');
}

/* Git stores text as LF (.gitattributes: text=auto eol=lf) and GitHub serves those
   bytes. Normalise here so the hashes in files.json match what editors download. */
function normalisedBytes(file) {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return buf; // binary: git leaves it alone too
    return Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

function removeDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyTree(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const name of fs.readdirSync(srcDir)) {
        if (NEVER_SHIP.has(name)) continue;
        const s = path.join(srcDir, name);
        const d = path.join(destDir, name);
        if (fs.statSync(s).isDirectory()) copyTree(s, d);
        else fs.writeFileSync(d, normalisedBytes(s));
    }
}

function listFiles(dir, base, out) {
    out = out || [];
    for (const name of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, name);
        const rel = base ? base + '/' + name : name;
        if (fs.statSync(p).isDirectory()) listFiles(p, rel, out);
        else out.push(rel);
    }
    return out;
}

function buildManifest(version) {
    const files = listFiles(DIST_EXT)
        .filter(rel => rel !== UpdateCore.MANIFEST_NAME && rel !== 'version.json')
        .map(rel => {
            const buf = fs.readFileSync(path.join(DIST_EXT, rel));
            return { path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
        });
    const manifest = { version, generatedAt: new Date().toISOString(), files };
    UpdateCore.parseManifest(manifest); // same validation the panel runs
    return manifest;
}

function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 4) + '\n');
}

function buildDist(versionData) {
    log('▶ Building dist/premiere-extension...');
    removeDir(DIST_EXT);
    for (const dir of SHIP_DIRS) copyTree(path.join(SRC, dir), path.join(DIST_EXT, dir));
    writeJson(path.join(DIST_EXT, 'version.json'), versionData);
    const manifest = buildManifest(versionData.version);
    writeJson(path.join(DIST_EXT, UpdateCore.MANIFEST_NAME), manifest);
    writeJson(ROOT_VERSION, versionData);
    log(`  ✓ ${manifest.files.length} files, manifest written`);

    log('▶ Building installer zip...');
    const zip = path.join(DIST, 'TeamSync-Installer.zip');
    const parts = ['install.bat', 'uninstall.bat', 'README.txt', 'premiere-extension']
        .map(p => `'${path.join(DIST, p).replace(/'/g, "''")}'`).join(', ');
    try {
        execFileSync('powershell', ['-NoProfile', '-Command',
            `Compress-Archive -Path ${parts} -DestinationPath '${zip.replace(/'/g, "''")}' -Force`], { stdio: 'pipe' });
        log('  ✓ ' + path.relative(ROOT, zip));
    } catch (e) {
        log('  ! Could not build the zip (' + String(e.stderr || e.message).split('\n')[0] + '). Auto-update is unaffected.');
    }
}

function checkGitReady() {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== 'main') fail(`You're on branch "${branch}". Editors update from main — switch to main first.`);
    const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);
    const outside = dirty.filter(l => {
        const p = l.slice(3).replace(/^"|"$/g, '');
        return !(p.startsWith('premiere-extension/') || p.startsWith('dist/') || p === 'version.json' || p.startsWith('scripts/') || p === 'release.bat' || p === 'build-dist.bat');
    });
    if (outside.length) {
        log('  ! These changes are NOT part of the release and will be left alone:');
        outside.forEach(l => log('      ' + l));
    }
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'TeamSync-Release' } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error('HTTP ' + res.statusCode)));
        }).on('error', reject);
    });
}

async function waitUntilLive(version) {
    log('▶ Waiting for GitHub to serve v' + version + ' (can take up to ~5 min)...');
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
        try {
            const remote = JSON.parse(await fetchText(REMOTE_VERSION_URL + '?t=' + Date.now()));
            if (remote.version === version) {
                log('  ✓ Live. Every open panel will show the update screen within 30 min (or when an editor clicks back into it).');
                return;
            }
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 15000));
    }
    log('  ! Not visible yet — GitHub caching is slow today. It will go live on its own; nothing else to do.');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const current = JSON.parse(fs.readFileSync(SRC_VERSION, 'utf8'));

    if (args.buildOnly) {
        buildDist(current);
        log('\nBuilt dist for v' + current.version + ' (no version bump, nothing committed).');
        return;
    }

    if (!args.bump) {
        // Double-clicked release.bat: ask instead of failing.
        if (!process.stdin.isTTY) {
            fail('Usage: release.bat <patch|minor|major|X.Y.Z> "What changed"\n  e.g. release.bat patch "Fixed pull asking for a sync folder"');
        }
        log(`Current version: v${current.version}\n`);
        log(`  1) patch  -> v${UpdateCore.bumpVersion(current.version, 'patch')}   (bug fixes)`);
        log(`  2) minor  -> v${UpdateCore.bumpVersion(current.version, 'minor')}   (new features)`);
        log(`  3) major  -> v${UpdateCore.bumpVersion(current.version, 'major')}`);
        const choice = (await ask('\nWhich release? [1/2/3 or X.Y.Z]: ')).trim();
        args.bump = { '1': 'patch', '2': 'minor', '3': 'major', '': 'patch' }[choice] || choice;
    }
    const version = UpdateCore.bumpVersion(current.version, args.bump);
    if (UpdateCore.compareVersions(version, current.version) <= 0) {
        fail(`New version v${version} must be higher than the current v${current.version}.`);
    }
    while (process.stdin.isTTY && changelogProblem(args.changelog)) {
        if (args.changelog) log('  ! ' + changelogProblem(args.changelog));
        args.changelog = (await ask(`Describe v${version} in a sentence (editors see this on the update screen): `)).trim();
    }
    if (changelogProblem(args.changelog)) fail(changelogProblem(args.changelog));

    if (!args.dryRun) checkGitReady();
    if (!args.dryRun && process.stdin.isTTY) {
        const ok = (await ask(`\nRelease v${version} ("${args.changelog}") to ALL editors now? [y/N]: `)).trim().toLowerCase();
        if (ok !== 'y' && ok !== 'yes') fail('Cancelled. Nothing was released.');
    }
    runTests();

    const versionData = {
        version,
        releaseDate: new Date().toISOString().slice(0, 10),
        changelog: args.changelog,
        downloadUrl: DOWNLOAD_URL
    };

    if (args.dryRun) {
        // Build at the CURRENT version so the tree stays consistent; nothing is bumped or committed.
        buildDist(current);
        log(`\nDry run OK: would release v${version} ("${args.changelog}"). dist/ rebuilt at v${current.version}; nothing committed.`);
        return;
    }

    writeJson(SRC_VERSION, versionData);
    buildDist(versionData);

    log('▶ Committing...');
    git(['add', '--all', '--', 'premiere-extension', 'dist', 'version.json', 'scripts', 'release.bat', 'build-dist.bat']);
    git(['commit', '-m', `v${version}: ${args.changelog}`]);
    git(['tag', '-a', `v${version}`, '-m', `v${version}: ${args.changelog}`]);
    log(`  ✓ committed + tagged v${version}`);

    if (args.noPush) {
        log('\n--no-push: run `git push origin main --follow-tags` when ready.');
        return;
    }
    log('▶ Pushing...');
    try {
        git(['push', 'origin', 'main', '--follow-tags'], { stdio: 'pipe' });
    } catch (e) {
        fail('Push failed: ' + String(e.stderr || e.message) + '\nThe release is committed locally; fix the problem and run: git push origin main --follow-tags');
    }
    log('  ✓ pushed');
    await waitUntilLive(version);
}

main().catch(e => fail(e.stack || e.message));
