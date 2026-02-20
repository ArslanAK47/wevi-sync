/**
 * Google Drive Service
 * Handles file uploads to Google Drive
 */

import { getValidToken } from './authService';
import { getBasename, sanitizeFilename } from '../utils/fileHelpers';
import { saveProject } from './premiereAPI';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const PROJECTS_FOLDER_NAME = 'PremiereProjects';

/**
 * Upload project to Google Drive
 * @param {Object} projectData - Project data from premiereAPI
 * @param {Function} onProgress - Progress callback (0-100)
 */
export async function uploadProject(projectData, onProgress) {
    try {
        onProgress(0);

        // Get valid access token
        const accessToken = await getValidToken();
        if (!accessToken) {
            throw new Error('Not authenticated. Please connect to Google Drive first.');
        }

        onProgress(5);

        // Save project first
        await saveProject();
        onProgress(10);

        // Get or create projects folder
        const rootFolderId = await getOrCreateFolder(accessToken, PROJECTS_FOLDER_NAME);
        onProgress(20);

        // Get or create specific project folder
        const projectName = sanitizeFilename(projectData.name.replace('.prproj', ''));
        const projectFolderId = await getOrCreateFolder(accessToken, projectName, rootFolderId);
        onProgress(30);

        // Upload .prproj file
        const projectFileId = await uploadFile(
            accessToken,
            projectData.path,
            projectData.name,
            projectFolderId
        );
        onProgress(70);

        // Create manifest
        const manifest = {
            projectName: projectData.name,
            uploadedAt: new Date().toISOString(),
            mediaCount: projectData.mediaCount,
            mediaSize: projectData.mediaSize,
            mediaFiles: projectData.mediaFiles.map(f => ({
                name: f.name,
                path: f.path,
                type: f.type
            })),
            version: 1
        };

        // Upload manifest
        await uploadJsonFile(accessToken, manifest, 'manifest.json', projectFolderId);
        onProgress(90);

        onProgress(100);

        return {
            success: true,
            projectFileId,
            folderId: projectFolderId
        };

    } catch (error) {
        console.error('Upload error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get or create a folder in Google Drive
 */
async function getOrCreateFolder(accessToken, folderName, parentFolderId = null) {
    // Search for existing folder
    let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentFolderId) {
        query += ` and '${parentFolderId}' in parents`;
    }

    const searchResponse = await fetch(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        }
    );

    const searchData = await searchResponse.json();

    if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
    }

    // Create new folder
    const metadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
    };

    if (parentFolderId) {
        metadata.parents = [parentFolderId];
    }

    const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });

    const createData = await createResponse.json();
    return createData.id;
}

/**
 * Upload a file to Google Drive
 */
async function uploadFile(accessToken, filePath, fileName, parentFolderId) {
    try {
        // Read file content
        let fileContent;

        if (typeof require !== 'undefined') {
            // UXP environment
            const { localFileSystem } = require('uxp').storage;
            const file = await localFileSystem.getFileForPath(filePath);
            fileContent = await file.read({ format: 'binary' });
        } else {
            // Mock for development
            fileContent = new ArrayBuffer(100);
        }

        // Create multipart request
        const boundary = '-------314159265358979323846';
        const delimiter = '\r\n--' + boundary + '\r\n';
        const closeDelimiter = '\r\n--' + boundary + '--';

        const metadata = {
            name: fileName,
            parents: [parentFolderId]
        };

        // Check if file exists and update instead
        const existingFileId = await findFile(accessToken, fileName, parentFolderId);

        let response;

        if (existingFileId) {
            // Update existing file
            response = await fetch(`${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/octet-stream'
                },
                body: fileContent
            });
        } else {
            // Create new file using multipart upload
            const body = new Blob([
                delimiter,
                'Content-Type: application/json\r\n\r\n',
                JSON.stringify(metadata),
                delimiter,
                'Content-Type: application/octet-stream\r\n\r\n',
                fileContent,
                closeDelimiter
            ]);

            response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body: body
            });
        }

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }

        const data = await response.json();
        return data.id;

    } catch (error) {
        console.error('File upload error:', error);
        throw error;
    }
}

/**
 * Upload JSON content as a file
 */
async function uploadJsonFile(accessToken, jsonContent, fileName, parentFolderId) {
    const content = JSON.stringify(jsonContent, null, 2);

    const existingFileId = await findFile(accessToken, fileName, parentFolderId);

    if (existingFileId) {
        // Update existing
        const response = await fetch(`${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: content
        });
        return (await response.json()).id;
    } else {
        // Create new
        const metadata = {
            name: fileName,
            mimeType: 'application/json',
            parents: [parentFolderId]
        };

        const boundary = '-------314159265358979323846';
        const body = [
            `--${boundary}`,
            'Content-Type: application/json',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: application/json',
            '',
            content,
            `--${boundary}--`
        ].join('\r\n');

        const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body: body
        });

        return (await response.json()).id;
    }
}

/**
 * Find a file by name in a folder
 */
async function findFile(accessToken, fileName, parentFolderId) {
    const query = `name='${fileName}' and '${parentFolderId}' in parents and trashed=false`;

    const response = await fetch(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id)`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        }
    );

    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * List projects in Drive
 */
export async function listProjects() {
    const accessToken = await getValidToken();
    if (!accessToken) return [];

    try {
        // Find projects folder
        const query = `name='${PROJECTS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const folderResponse = await fetch(
            `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id)`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const folderData = await folderResponse.json();
        if (!folderData.files || folderData.files.length === 0) {
            return [];
        }

        const rootFolderId = folderData.files[0].id;

        // List subfolders (each is a project)
        const projectsQuery = `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const projectsResponse = await fetch(
            `${DRIVE_API_BASE}/files?q=${encodeURIComponent(projectsQuery)}&fields=files(id,name,modifiedTime)`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const projectsData = await projectsResponse.json();
        return projectsData.files || [];

    } catch (error) {
        console.error('Error listing projects:', error);
        return [];
    }
}
