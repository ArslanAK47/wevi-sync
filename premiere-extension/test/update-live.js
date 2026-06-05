/* Live end-to-end test of the GitHub auto-update data path.
   Run: node premiere-extension/test/update-live.js
   Reproduces what update-checker.js does against the REAL repo:
     1. fetch remote version.json
     2. recurse the GitHub Contents API to list dist files
     3. download a few files and verify bytes / JS parses
   Reports the rate-limit risk of the Contents API. */

'use strict';
const https = require('https');
const vm = require('vm');

const VERSION_URL = 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/version.json';
const CONTENTS_API = 'https://api.github.com/repos/ArslanAK47/wevi-sync/contents/dist/premiere-extension';
const RAW_BASE = 'https://raw.githubusercontent.com/ArslanAK47/wevi-sync/main/dist/premiere-extension';

function get(url, json) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'TeamSync-UpdateTest', 'Accept': json ? 'application/vnd.github.v3+json' : '*/*' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location, json).then(resolve, reject); return; }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' for ' + url + ' :: ' + buf.toString('utf8').slice(0, 200))); return; }
                resolve({ buf, headers: res.headers });
            });
        }).on('error', reject);
    });
}

let apiCalls = 0;
async function listTree(apiUrl, acc) {
    acc = acc || [];
    apiCalls++;
    const { buf } = await get(apiUrl, true);
    const items = JSON.parse(buf.toString('utf8'));
    for (const item of items) {
        if (item.type === 'file') acc.push({ path: item.path, download_url: item.download_url, sha: item.sha, size: item.size });
        else if (item.type === 'dir') await listTree(item.url, acc);
    }
    return acc;
}

(async () => {
    let ok = true;
    try {
        console.log('1) remote version.json');
        const { buf: vbuf } = await get(VERSION_URL, false);
        const remote = JSON.parse(vbuf.toString('utf8'));
        console.log('   version=' + remote.version + ' releaseDate=' + remote.releaseDate);
        if (!/^\d+\.\d+\.\d+$/.test(remote.version)) throw new Error('bad remote version: ' + remote.version);

        console.log('2) recurse Contents API for dist/premiere-extension');
        const files = await listTree(CONTENTS_API);
        console.log('   ' + files.length + ' files via ' + apiCalls + ' API calls (one per directory)');
        const top = files.map(f => f.path.replace('dist/premiere-extension/', '').split('/')[0]);
        ['CSXS', 'client', 'host', 'icons', 'version.json'].forEach(expected => {
            if (top.indexOf(expected) === -1) throw new Error('expected top-level entry missing: ' + expected);
        });
        console.log('   top-level OK: CSXS, client, host, icons, version.json present');

        console.log('3) download representative files + verify');
        const picks = files.filter(f => /version\.json$|main\.js$|manifest\.xml$/.test(f.path)).slice(0, 3);
        for (const f of picks) {
            const url = f.download_url || (RAW_BASE + '/' + f.path.replace('dist/premiere-extension/', ''));
            const { buf } = await get(url, false);
            if (!buf.length) throw new Error('empty download: ' + f.path);
            if (f.path.endsWith('.js')) {
                new vm.Script(buf.toString('utf8'), { filename: f.path }); // throws on syntax error
            }
            if (f.path.endsWith('version.json')) JSON.parse(buf.toString('utf8'));
            console.log('   OK ' + f.path + ' (' + buf.length + ' bytes)');
        }

        console.log('\nRATE-LIMIT NOTE: the unauthenticated GitHub Contents API used above is limited to');
        console.log('60 requests/hour and made ' + apiCalls + ' calls (one per directory). The Git Trees API');
        console.log('(/git/trees/main?recursive=1) returns the whole tree in ONE request — recommended switch.');
        const remaining = null;
    } catch (e) {
        ok = false;
        console.error('\nLIVE UPDATE TEST FAILED: ' + e.message);
    }
    console.log('\n' + (ok ? 'LIVE UPDATE PATH: OK' : 'LIVE UPDATE PATH: FAILED'));
    process.exit(ok ? 0 : 1);
})();
