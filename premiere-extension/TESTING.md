# Team Sync — Test Plan

Two layers: **automated** (runs anywhere with Node, no Premiere) and **manual**
(must run inside Premiere Pro / After Effects on your machine).

---

## 1. Automated tests (run these first, after any code change)

```bat
node premiere-extension\test\run.js          :: pure logic (paths, IDs, conflict, locks, errors, versions)
node premiere-extension\test\update-live.js   :: real GitHub auto-update data path
```

`run.js` must print `29 passed, 0 failed` (count grows as tests are added).
`update-live.js` must print `LIVE UPDATE PATH: OK`.

These cover: Drive-relative path building, AE manifest path parity, relink target
selection (incl. duplicate basenames), project-ID generation/parse/folder decisions,
conflict detection, lock helpers, Drive error messages, and version.json consistency.

---

## 2. Install the dev build into Premiere

1. Enable CEP debug mode (one time), then copy `premiere-extension/` to
   `%APPDATA%\Adobe\CEP\extensions\com.premieresync.panel\` (see README).
2. Launch Premiere → **Window → Extensions → Team Sync**.
3. Open Chrome DevTools at `http://localhost:8088` to watch the panel console, and
   use the panel's built-in Debug Console (▼ at the bottom) — copy logs from there
   if anything fails.

> After each code change you must re-copy the changed files (or rebuild with
> `build-dist.bat`) and reopen the panel.

---

## 3. Manual scenarios (check each box; paste console logs for any failure)

### A. Identity & team folder (Part K)
- [ ] First launch after sign-in prompts for the team folder; choosing **default**
      works, and choosing **enter your own** accepts a Drive folder link or ID.
- [ ] **Settings → Team Folder → Change** updates the folder and refreshes the list.
- [ ] Two installs pointed at **different** team folders do **not** see each other's
      projects.

### B. Push — basics & error reporting (Bug C)
- [ ] Push a project with timeline media. The Drive folder is named
      `<ProjectName>__<16-hex-id>`. All expected files are present.
- [ ] The upload report lists every file; any failure shows a **non-empty reason**
      (e.g. an HTTP code + Drive message + hint), and the report banner shows
      "N file(s) failed".
- [ ] Force a failure (e.g. revoke Drive access mid-push) → the reason is descriptive,
      not blank or "undefined".
- [ ] The project auto-saves before scanning (make an unsaved edit, push, confirm the
      pushed `.prproj` reflects it — Part J).

### C. Same-name projects (Bug D)
- [ ] Create a **second, different** project with the **same name** and push it.
      It gets its **own** `<Name>__<id2>` folder; the first project is untouched.
- [ ] A `*.wevisync.json` sidecar sits in each project's Drive folder.
- [ ] Re-push an unchanged project → files are skipped (MD5), no duplicates.
- [ ] Legacy check: a project previously pushed under a plain name folder gets
      **adopted** (renamed to `<Name>__<id>`) on the next push, keeping its files.

### D. After Effects auto-relink (Bug E) — the core fix
- [ ] Push a project whose timeline contains an **AE comp** (Dynamic Link or rendered).
      Footage uploads with **real filenames** (no `[AE] ` prefix) and a
      `<aep>.aerelink.json` sits next to the `.aep` on Drive.
- [ ] On a **clean machine/folder**, pull the project:
  - [ ] Premiere media relinks (online).
  - [ ] **After Effects opens with its footage online automatically** — no manual
        relink. Confirm the `.aep` was re-saved (footage no longer "missing").
- [ ] Pull with After Effects **closed / not installed** → a toast says footage was
      downloaded and Premiere pull still completes successfully.
- [ ] Two different media files sharing a basename (e.g. `a/intro.mp4`, `b/intro.mp4`)
      each relink to the **correct** file after pull (Part E relink-by-path).
- [ ] Legacy: pull a project pushed **before** this change → it pulls as before
      (no crash; just no AE auto-relink).

### E. Locking (Part H — was previously broken)
- [ ] Editor A clicks **Lock & Edit** on a project. Within ~30s (one poll), Editor B
      sees the 🔒 with A's name and cannot lock/edit it.
- [ ] A `.wevisync.lock` file appears in that project's Drive folder.
- [ ] A clicks **Release Lock** → the file is removed and B can now lock it.
- [ ] B trying to unlock A's lock is refused ("you do not own this lock").
- [ ] A lock older than 8h shows as **stale** (takeover allowed).

### F. Conflict detection (Part I)
- [ ] A and B both pull project P. A edits and pushes. B then edits and pushes →
      B is **warned** ("P was updated by A…") with Overwrite / Cancel.
- [ ] Choosing Cancel stops the push; pulling first then pushing succeeds with no warning.
- [ ] First-ever push of a brand-new project shows **no** false conflict.

### G. Pull robustness
- [ ] Pull into an empty sync folder; cancel midway → no crash; re-pull resumes/skips
      already-downloaded files.
- [ ] Re-pull an up-to-date project → everything skipped, fast.

### H. Auto-update (Parts A & G)
- [ ] Settings shows the correct version; **Check for Updates** works.
- [ ] Temporarily bump the **remote** `version.json` (e.g. 1.5.4) → update modal
      appears → **Update Now** downloads/overwrites files → restart prompt → after
      restart the panel reports the new version and the local `version.json` updated.
- [ ] If GitHub rate-limits the file listing, the failure message is clear (consider
      the Trees-API follow-up if this happens often).

---

## 4. Reporting back
For any failed box, copy: the panel Debug Console text, the DevTools console, and
(for AE) whether After Effects was open. Paste them here and I'll fix + we re-run
the automated suite and the affected manual steps.
