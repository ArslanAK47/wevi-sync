/* ============================================
   GOOGLE DRIVE API - LOOPBACK OAUTH FLOW
   ============================================ */

/**
 * Retry helper for Google Drive API calls (handles 500/503 errors)
 */
async function withRetry(fn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const is500 = err.message && (err.message.includes('500') || err.message.includes('503') || err.message.includes('Internal Error'));
            if (is500 && attempt < maxRetries) {
                const delay = attempt * 1500;
                console.warn(`⚠️ Attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

// Always-non-empty, actionable Drive error message (uses DriveErrors when loaded).
function driveErrorMessage(status, statusText, body, context) {
    if (typeof DriveErrors !== 'undefined' && DriveErrors.describeDriveError) {
        return DriveErrors.describeDriveError(status, statusText, body, context);
    }
    return `${context} failed: HTTP ${status || 0} ${statusText || ''} ${body || ''}`.trim();
}

// Escape a value for safe interpolation into a Drive `q=` query string literal.
function driveQ(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const GoogleDrive = {
    accessToken: null,
    refreshToken: null,
    tokenExpiry: null,
    _authServer: null,

    // =============================================
    // OAUTH LOOPBACK AUTHENTICATION
    // =============================================

    /**
     * Check if user is authenticated
     */
    async isAuthenticated() {
        const token = this.loadToken();
        if (token && token.refresh_token) {
            this.refreshToken = token.refresh_token;
            return true;
        }
        return false;
    },

    /**
     * Start Loopback OAuth Flow
     * Opens browser → user logs in → Google redirects to localhost → we catch the code
     */
    async startLoopbackAuth() {
        console.log('🔐 Starting Loopback OAuth Flow...');

        const http = require('http');
        const url = require('url');

        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                try {
                    const parsedUrl = url.parse(req.url, true);
                    if (parsedUrl.pathname !== '/callback') {
                        res.writeHead(404);
                        res.end('Not found');
                        return;
                    }

                    const code = parsedUrl.query.code;
                    const error = parsedUrl.query.error;

                    if (error) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<html><body style="background:#1e1e1e;color:#ff6b6b;font-family:Arial;text-align:center;padding:60px;"><h1>❌ Authorization Failed</h1><p>' + error + '</p><p>Close this tab and try again.</p></body></html>');
                        server.close();
                        this._authServer = null;
                        reject(new Error('Authorization denied: ' + error));
                        return;
                    }

                    if (!code) {
                        res.writeHead(400);
                        res.end('Missing code');
                        return;
                    }

                    // Exchange code for tokens
                    console.log('🔄 Exchanging code for tokens...');
                    const port = server.address().port;
                    const redirectUri = 'http://127.0.0.1:' + port + '/callback';

                    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            code: code,
                            client_id: GoogleDriveConfig.clientId,
                            client_secret: GoogleDriveConfig.clientSecret,
                            redirect_uri: redirectUri,
                            grant_type: 'authorization_code'
                        })
                    });

                    const tokenData = await tokenRes.json();

                    if (!tokenRes.ok) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<html><body style="background:#1e1e1e;color:#ff6b6b;font-family:Arial;text-align:center;padding:60px;"><h1>❌ Error</h1><p>' + (tokenData.error_description || tokenData.error) + '</p></body></html>');
                        server.close();
                        this._authServer = null;
                        reject(new Error(tokenData.error_description || 'Token exchange failed'));
                        return;
                    }

                    // Save tokens
                    this.accessToken = tokenData.access_token;
                    this.refreshToken = tokenData.refresh_token;
                    this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
                    this.saveToken({
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        expires_in: tokenData.expires_in,
                        token_type: tokenData.token_type
                    });

                    // Success page
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body style="background:#1e1e1e;color:#51cf66;font-family:Arial;text-align:center;padding:60px;"><h1>✅ Connected!</h1><p>Google Drive connected. You can close this tab.</p><script>setTimeout(function(){window.close()},3000);</script></body></html>');

                    console.log('✅ Authorization successful!');
                    server.close();
                    this._authServer = null;
                    resolve(tokenData);
                } catch (err) {
                    res.writeHead(500);
                    res.end('Error');
                    server.close();
                    this._authServer = null;
                    reject(err);
                }
            });

            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                this._authServer = server;
                console.log('🌐 Auth server on port ' + port);

                const redirectUri = 'http://127.0.0.1:' + port + '/callback';
                const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
                    new URLSearchParams({
                        client_id: GoogleDriveConfig.clientId,
                        redirect_uri: redirectUri,
                        response_type: 'code',
                        scope: GoogleDriveConfig.scopes.join(' '),
                        access_type: 'offline',
                        prompt: 'consent'
                    }).toString();

                console.log('🌐 Opening browser...');
                if (typeof cep !== 'undefined' && cep.util && cep.util.openURLInDefaultBrowser) {
                    cep.util.openURLInDefaultBrowser(authUrl);
                } else {
                    window.open(authUrl, '_blank');
                }
            });

            // 5min timeout
            setTimeout(() => {
                if (this._authServer) {
                    server.close();
                    this._authServer = null;
                    reject(new Error('Authorization timed out'));
                }
            }, 300000);
        });
    },

    /**
     * Cancel ongoing authorization
     */
    cancelAuth() {
        if (this._authServer) {
            this._authServer.close();
            this._authServer = null;
            console.log('❌ Authorization cancelled');
        }
    },

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            const token = this.loadToken();
            if (token && token.refresh_token) {
                this.refreshToken = token.refresh_token;
            } else {
                throw new Error('No refresh token available');
            }
        }

        console.log('🔄 Refreshing access token...');

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GoogleDriveConfig.clientId,
                client_secret: GoogleDriveConfig.clientSecret,
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to refresh token');
        }

        const data = await response.json();
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000);

        // Update stored token
        const storedToken = this.loadToken();
        storedToken.access_token = data.access_token;
        storedToken.expires_in = data.expires_in;
        this.saveToken(storedToken);

        console.log('✅ Token refreshed');
        return this.accessToken;
    },

    /**
     * Get valid access token (refresh if needed)
     */
    async getValidToken() {
        // Check if current token is valid
        if (this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now() + 60000) {
            return this.accessToken;
        }

        // Try to refresh
        return await this.refreshAccessToken();
    },

    /**
     * Save token to localStorage
     */
    saveToken(token) {
        try {
            localStorage.setItem(GoogleDriveConfig.tokenStorageKey, JSON.stringify(token));
            console.log('💾 Token saved to localStorage');
        } catch (error) {
            console.error('Failed to save token:', error);
        }
    },

    /**
     * Load token from localStorage
     */
    loadToken() {
        try {
            const stored = localStorage.getItem(GoogleDriveConfig.tokenStorageKey);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load token:', error);
        }
        return null;
    },

    /**
     * Logout (clear token and revoke with Google)
     */
    logout() {
        // Revoke the token with Google to force fresh re-auth with new scopes
        const token = this.loadToken();
        if (token && token.access_token) {
            fetch(`https://oauth2.googleapis.com/revoke?token=${token.access_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }).then(() => {
                console.log('🔑 Token revoked with Google');
            }).catch(e => {
                console.warn('Token revoke failed (ok if expired):', e);
            });
        }

        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        localStorage.removeItem(GoogleDriveConfig.tokenStorageKey);
        console.log('👋 Logged out and token revoked');
    },

    // =============================================
    // TEAM SHARING (drive.file scope workaround)
    // =============================================

    /**
     * Share a file/folder with all team members
     * This allows other users to see files despite drive.file scope
     */
    async shareWithTeam(fileId) {
        const emails = GoogleDriveConfig.teamEmails || [];
        if (emails.length === 0) {
            console.log('ℹ️ No team emails configured, skipping sharing');
            return;
        }

        const token = await this.getValidToken();
        if (!token) return;

        console.log(`👥 Sharing ${fileId} with ${emails.length} team member(s)...`);

        for (const email of emails) {
            try {
                const res = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            role: 'writer',
                            type: 'user',
                            emailAddress: email
                        })
                    }
                );

                if (res.ok) {
                    console.log(`  ✅ Shared with ${email}`);
                } else {
                    const errorText = await res.text();
                    console.warn(`  ⚠️ Could not share with ${email}: ${errorText}`);
                }
            } catch (e) {
                console.warn(`  ⚠️ Share error for ${email}:`, e);
            }
        }
    },

    // =============================================
    // FOLDER OPERATIONS
    // =============================================

    /**
     * Get or create a folder in Drive
     */
    async getOrCreateFolder(folderName, parentId = null) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');

        // Search for existing folder
        let query = `mimeType='application/vnd.google-apps.folder' and name='${driveQ(folderName)}' and trashed=false`;
        if (parentId) {
            query += ` and '${driveQ(parentId)}' in parents`;
        }

        console.log(`🔍 Searching for folder "${folderName}" in parent: ${parentId || 'root'}`);

        const searchRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!searchRes.ok) {
            const errorText = await searchRes.text();
            console.error('❌ Folder search failed:', searchRes.status, errorText);
            throw new Error(driveErrorMessage(searchRes.status, searchRes.statusText, errorText, `Searching for folder "${folderName}"`));
        }

        const searchData = await searchRes.json();
        console.log('🔍 Search result:', searchData);

        if (searchData.files && searchData.files.length > 0) {
            console.log(`✅ Found existing folder: ${searchData.files[0].id}`);
            return searchData.files[0].id;
        }

        // Create new folder
        console.log(`📁 Creating new folder: ${folderName}`);

        const metadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
        };

        if (parentId) {
            metadata.parents = [parentId];
        }

        const createRes = await fetch(
            'https://www.googleapis.com/drive/v3/files?fields=id',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(metadata)
            }
        );

        if (!createRes.ok) {
            const errorText = await createRes.text();
            console.error('❌ Folder creation failed:', createRes.status, errorText);
            throw new Error(driveErrorMessage(createRes.status, createRes.statusText, errorText, `Creating folder "${folderName}"`));
        }

        const createData = await createRes.json();
        console.log(`✅ Created folder: ${createData.id}`);
        return createData.id;
    },

    /**
     * List projects in a folder
     */
    async listProjects(folderId) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');

        const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        console.log(`📂 Listing projects in folder: ${folderId}`);
        console.log(`📂 Query: ${query}`);

        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,owners,lastModifyingUser(displayName,emailAddress))&includeItemsFromAllDrives=true&supportsAllDrives=true`;
        console.log(`📂 URL: ${url}`);

        const data = await withRetry(async () => {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error(`❌ List projects failed: ${res.status}`, errorText);
                throw new Error(driveErrorMessage(res.status, res.statusText, errorText, 'Listing team projects'));
            }

            return await res.json();
        });

        console.log(`📂 Found ${data.files?.length || 0} projects:`, data.files?.map(f => f.name));
        return data.files || [];
    },

    /**
     * The team's shared "Projects" folder id. Configurable per install
     * (Config.data.teamFolderId), falling back to the hardcoded default so
     * existing installs keep working.
     */
    getTeamFolderId() {
        try {
            if (typeof Config !== 'undefined' && Config.data && Config.data.teamFolderId) {
                return Config.data.teamFolderId;
            }
        } catch (e) { /* ignore */ }
        return GoogleDriveConfig.teamProjectsFolderId;
    },

    /**
     * Rename a Drive file/folder.
     */
    async renameFile(fileId, newName) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name`,
            {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            }
        );
        if (!res.ok) {
            const t = await res.text();
            throw new Error(driveErrorMessage(res.status, res.statusText, t, `Renaming to "${newName}"`));
        }
        return await res.json();
    },

    /**
     * "Touch" a Drive folder so its modifiedTime reflects the last push.
     * A folder's modifiedTime does NOT change when children change, so both
     * the panel list and Drive web would otherwise show a stale date.
     */
    async touchFolder(folderId) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=id,modifiedTime`,
            {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ modifiedTime: new Date().toISOString() })
            }
        );
        if (!res.ok) {
            const t = await res.text();
            throw new Error(driveErrorMessage(res.status, res.statusText, t, 'Updating folder date'));
        }
        return await res.json();
    },

    /**
     * Resolve (and if needed create/adopt) the top-level Drive folder for a
     * project, namespaced as "<cleanName>__<projectId>" so two same-named
     * projects never collide. Adopts a legacy plain-name folder by renaming it.
     * @param {{cleanName:string,projectId:string}} opts
     * @returns {{folderId:string, canonicalName:string, adopted:boolean}}
     */
    async resolveProjectFolder(opts, parentId) {
        const children = await this.listProjects(parentId);
        const decision = ProjectId.decideProjectFolderAction(
            children.map(c => ({ id: c.id, name: c.name })), opts.cleanName, opts.projectId);

        if (decision.action === 'exact' || decision.action === 'byId') {
            return { folderId: decision.id, canonicalName: decision.name, adopted: false };
        }
        if (decision.action === 'adopt') {
            try {
                await this.renameFile(decision.id, decision.name);
                console.log(`🔁 Adopted legacy folder "${opts.cleanName}" → "${decision.name}"`);
                return { folderId: decision.id, canonicalName: decision.name, adopted: true };
            } catch (e) {
                console.warn('Could not rename legacy folder, using it as-is:', e.message);
                return { folderId: decision.id, canonicalName: opts.cleanName, adopted: false };
            }
        }
        const folderId = await this.getOrCreateFolder(decision.name, parentId);
        return { folderId: folderId, canonicalName: decision.name, adopted: false };
    },

    /**
     * Current Drive user (works with the drive scope via the about endpoint).
     * @returns {{email:string,name:string}|null}
     */
    async getUserInfo() {
        const token = await this.getValidToken();
        if (!token) return null;
        try {
            const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.user ? { email: data.user.emailAddress || '', name: data.user.displayName || '' } : null;
        } catch (e) {
            console.warn('getUserInfo failed:', e.message);
            return null;
        }
    },

    /**
     * Find a project folder under the team folder by projectId (preferred) or clean name.
     * @param {{cleanName?:string, projectId?:string}} opts
     */
    async findProjectFolder(opts) {
        const folders = await this.listProjects(this.getTeamFolderId());
        if (opts.projectId) {
            for (const f of folders) {
                const p = ProjectId.parseDriveFolderName(f.name);
                if (p.projectId && p.projectId === String(opts.projectId).toLowerCase()) return { id: f.id, name: f.name };
            }
        }
        if (opts.cleanName) {
            for (const f of folders) {
                if (ProjectId.parseDriveFolderName(f.name).cleanName === opts.cleanName) return { id: f.id, name: f.name };
            }
        }
        return null;
    },

    /**
     * Metadata for a project's .prproj on Drive (for conflict detection).
     */
    async getProjectPrprojMeta(folderId, prprojName) {
        const token = await this.getValidToken();
        const q = `name='${driveQ(prprojName)}' and '${driveQ(folderId)}' in parents and trashed=false`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,md5Checksum,modifiedTime,lastModifyingUser(displayName,emailAddress))&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return null;
        const data = await res.json();
        const f = data.files && data.files[0];
        if (!f) return null;
        return { id: f.id, md5: f.md5Checksum, modifiedTime: f.modifiedTime, lastModifyingUser: f.lastModifyingUser };
    },

    // =============================================
    // PROJECT LOCKS (Drive-based — replaces the old admin server)
    // =============================================
    LOCK_FILE_NAME: '.wevisync.lock',

    async findLockFile(projectFolderId) {
        const token = await this.getValidToken();
        const q = `name='${driveQ(this.LOCK_FILE_NAME)}' and '${driveQ(projectFolderId)}' in parents and trashed=false`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return null;
        const data = await res.json();
        return (data.files && data.files[0]) || null;
    },

    async readLock(projectFolderId) {
        const f = await this.findLockFile(projectFolderId);
        if (!f) return null;
        const token = await this.getValidToken();
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`,
                { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return null;
            const obj = JSON.parse(await res.text());
            obj._fileId = f.id;
            return obj;
        } catch (e) { return null; }
    },

    async writeLock(projectFolderId, lockObj) {
        // uploadFileWithProgress handles create-or-update by name within the folder.
        return await uploadFileWithProgress(this.LOCK_FILE_NAME, JSON.stringify(lockObj, null, 2), 'application/json', projectFolderId);
    },

    async deleteLock(projectFolderId) {
        const f = await this.findLockFile(projectFolderId);
        if (!f) return;
        const token = await this.getValidToken();
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`,
            { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    },

    /**
     * One-query lock listing across many project folders, then download each lock's
     * content. Returns [{ parentId, lock }]. Only active locks are downloaded.
     */
    async listLocks(folderIds) {
        if (!folderIds || folderIds.length === 0) return [];
        const token = await this.getValidToken();
        const parentClause = folderIds.map(id => `'${driveQ(id)}' in parents`).join(' or ');
        const q = `name='${driveQ(this.LOCK_FILE_NAME)}' and trashed=false and (${parentClause})`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,parents)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return [];
        const data = await res.json();
        const results = [];
        for (const f of (data.files || [])) {
            try {
                const cres = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`,
                    { headers: { 'Authorization': `Bearer ${token}` } });
                if (!cres.ok) continue;
                const obj = JSON.parse(await cres.text());
                obj._fileId = f.id;
                results.push({ parentId: (f.parents && f.parents[0]) || null, lock: obj });
            } catch (e) { /* skip unreadable lock */ }
        }
        return results;
    },

    // =============================================
    // FILE OPERATIONS
    // =============================================

    /**
     * Upload a file to Drive (kept for compatibility, but now uses OAuth token)
     */
    async uploadFile(fileName, content, mimeType, folderId) {
        // This function is now defined in upload-xhr.js as uploadFileWithProgress
        // We keep this wrapper for backward compatibility
        return await uploadFileWithProgress(fileName, content, mimeType, folderId);
    },

    /**
     * Upload a project to Google Drive
     */
    async uploadProject(projectData, onProgress) {
        try {
            onProgress(5);

            // Use the configured shared TeamProjects folder
            const rootFolderId = GoogleDriveConfig.teamProjectsFolderId;
            console.log('📁 Using TeamProjects folder:', rootFolderId);

            if (!rootFolderId) {
                throw new Error('teamProjectsFolderId not configured in google-config.js');
            }

            onProgress(15);

            // Create project-specific folder inside TeamProjects
            const projectName = projectData.name.replace('.prproj', '');
            const projectFolderId = await this.getOrCreateFolder(projectName, rootFolderId);
            console.log('📁 Created project folder:', projectFolderId);
            onProgress(25);

            // Create manifest
            const manifest = {
                projectName: projectData.name,
                uploadedBy: 'OAuth User',  // OAuth doesn't have fixed email
                uploadedAt: new Date().toISOString(),
                path: projectData.path,
                mediaCount: projectData.mediaFiles?.length || 0,
                mediaFiles: projectData.mediaFiles || []
            };

            // Upload manifest
            await this.uploadFile(
                'manifest.json',
                JSON.stringify(manifest, null, 2),
                'application/json',
                projectFolderId
            );
            onProgress(50);

            // Read and upload .prproj file
            if (projectData.path && typeof cep !== 'undefined' && cep.fs) {
                const readResult = cep.fs.readFile(projectData.path);
                if (readResult.err === 0) {
                    await this.uploadFile(
                        projectData.name,
                        readResult.data,
                        'application/octet-stream',
                        projectFolderId
                    );
                }
            }
            onProgress(100);

            return { success: true, folderId: projectFolderId };
        } catch (error) {
            console.error('Upload error:', error);
            return { success: false, error: error.message };
        }
    },

    // =============================================
    // DOWNLOAD OPERATIONS
    // =============================================

    /**
     * List all files in a project folder
     */
    async listFilesInFolder(folderId) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');

        const allFiles = [];
        const folderStack = [{ id: folderId, pathPrefix: '' }];

        while (folderStack.length > 0) {
            const current = folderStack.pop();
            let pageToken = '';

            do {
                const query = `'${current.id}' in parents and trashed=false`;
                const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
                const data = await withRetry(async () => {
                    const res = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        throw new Error(driveErrorMessage(res.status, res.statusText, errorText, 'Listing project files'));
                    }

                    return await res.json();
                });
                const files = data.files || [];

                for (const file of files) {
                    if (file.mimeType === 'application/vnd.google-apps.folder') {
                        folderStack.push({
                            id: file.id,
                            pathPrefix: current.pathPrefix ? `${current.pathPrefix}/${file.name}` : file.name
                        });
                    } else {
                        allFiles.push({
                            ...file,
                            name: current.pathPrefix ? `${current.pathPrefix}/${file.name}` : file.name
                        });
                    }
                }

                pageToken = data.nextPageToken || '';
            } while (pageToken);
        }

        return allFiles;
    },

    /**
     * Download a single file from Drive
     */
    async downloadFile(fileId, onProgress) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');

        const blob = await withRetry(async () => {
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            if (!res.ok) {
                throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
            }

            return await res.blob();
        });

        // Convert blob to ArrayBuffer for CEP file system
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        if (onProgress) onProgress(100);

        return uint8Array;
    },

    /**
     * Get file metadata (for conflict detection)
     */
    async getFileMetadata(fileId) {
        const token = await this.getValidToken();
        if (!token) throw new Error('Not authenticated');

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,md5Checksum,size,modifiedTime`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!res.ok) {
            throw new Error('Failed to get file metadata');
        }

        return await res.json();
    },

    /**
     * Download entire project folder
     */
    async downloadProject(projectFolderId, targetPath, onFileProgress) {
        try {
            console.log(`📥 Downloading project from folder: ${projectFolderId}`);

            // List all files in the project folder
            const files = await this.listFilesInFolder(projectFolderId);
            console.log(`Found ${files.length} files to download`);

            const downloadedFiles = [];

            for (const file of files) {
                console.log(`Downloading: ${file.name}`);

                const content = await this.downloadFile(file.id, (progress) => {
                    if (onFileProgress) {
                        onFileProgress(file.name, progress);
                    }
                });

                downloadedFiles.push({
                    name: file.name,
                    content: content,
                    mimeType: file.mimeType,
                    md5Checksum: file.md5Checksum,
                    size: file.size,
                    modifiedTime: file.modifiedTime
                });
            }

            return { success: true, files: downloadedFiles };
        } catch (error) {
            console.error('Download error:', error);
            return { success: false, error: error.message };
        }
    }
};
