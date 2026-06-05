// Reliable upload function with retry + resumable uploads for large files.
// fileInput can be Uint8Array/string OR { filePath, size }.
const DRIVE_RESUMABLE_THRESHOLD = 8 * 1024 * 1024; // 8 MB
const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB
const DRIVE_MAX_RETRIES = 4;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createUploadError(message, status = null, retriable = false, retryAfterMs = null) {
    const err = new Error(message);
    err.status = status;
    err.retriable = retriable;
    err.retryAfterMs = retryAfterMs;
    return err;
}

// Build an upload error with an always-non-empty, actionable message.
// Uses DriveErrors.describeDriveError (loaded globally in the panel) and falls
// back to a plain string when it isn't available (e.g. outside the panel).
function driveUploadError(status, statusText, body, context, retriable, retryAfterMs) {
    let message;
    if (typeof DriveErrors !== 'undefined' && DriveErrors.describeDriveError) {
        message = DriveErrors.describeDriveError(status, statusText, body, context);
    } else {
        message = `${context} failed: HTTP ${status || 0} ${statusText || ''} ${body || ''}`.trim();
    }
    return createUploadError(message, status, retriable, retryAfterMs);
}

function getRetryAfterMs(xhrOrRes) {
    try {
        const retryAfter = xhrOrRes?.getResponseHeader
            ? xhrOrRes.getResponseHeader('Retry-After')
            : xhrOrRes?.headers?.get('Retry-After');
        if (!retryAfter) return null;
        const seconds = parseInt(retryAfter, 10);
        if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
    } catch (e) {
        // ignore bad header parsing
    }
    return null;
}

function shouldRetryStatus(status) {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function buildRetryDelayMs(attempt, explicitRetryAfterMs = null) {
    if (explicitRetryAfterMs && explicitRetryAfterMs > 0) return explicitRetryAfterMs;
    const base = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    return base + jitter;
}

function getDynamicTimeoutMs(byteLength) {
    const minTimeout = 10 * 60 * 1000; // 10 minutes
    const maxTimeout = 2 * 60 * 60 * 1000; // 2 hours
    // Assume worst-case ~0.5 MB/s.
    const estimated = Math.ceil(byteLength / (0.5 * 1024 * 1024)) * 1000;
    return Math.min(maxTimeout, Math.max(minTimeout, estimated));
}

function normalizeContent(fileInput) {
    if (typeof fileInput === 'string') {
        return new TextEncoder().encode(fileInput);
    }
    if (fileInput && typeof fileInput === 'object' && fileInput.filePath) {
        if (typeof require === 'undefined') {
            throw createUploadError('Node.js fs is required for file-path uploads', null, false);
        }
        const fs = require('fs');
        const buffer = fs.readFileSync(fileInput.filePath);
        return new Uint8Array(buffer);
    }
    return fileInput;
}

function getFileInputSize(fileInput) {
    if (fileInput && typeof fileInput === 'object' && fileInput.filePath) {
        if (typeof fileInput.size === 'number') return fileInput.size;
        try {
            const fs = require('fs');
            return fs.statSync(fileInput.filePath).size;
        } catch (e) {
            return 0;
        }
    }
    const normalized = normalizeContent(fileInput);
    return normalized?.length || 0;
}

async function computeLocalMd5(fileInput) {
    try {
        if (typeof require === 'undefined') return null;
        const crypto = require('crypto');

        if (fileInput && typeof fileInput === 'object' && fileInput.filePath) {
            const fs = require('fs');
            const hash = crypto.createHash('md5');
            await new Promise((resolve, reject) => {
                const stream = fs.createReadStream(fileInput.filePath);
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            return hash.digest('hex');
        }

        const content = normalizeContent(fileInput);
        if (!content) return null;
        return crypto.createHash('md5').update(Buffer.from(content)).digest('hex');
    } catch (e) {
        console.warn('Could not calculate local MD5:', e.message || e);
        return null;
    }
}

async function findExistingDriveFile(fileName, folderId, token) {
    const safeName = String(fileName).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `name='${safeName}' and '${folderId}' in parents and trashed=false`;
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,size,md5Checksum,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!searchRes.ok) {
        const errorText = await searchRes.text();
        throw driveUploadError(searchRes.status, searchRes.statusText, errorText, `Checking Drive for "${fileName}"`, shouldRetryStatus(searchRes.status), getRetryAfterMs(searchRes));
    }

    const searchData = await searchRes.json();
    return searchData.files?.[0] || null;
}

async function ensureDriveFileMetadata(fileName, folderId, token, existingId) {
    if (existingId) return existingId;

    const createRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: fileName,
                parents: [folderId]
            })
        }
    );

    if (!createRes.ok) {
        const errorText = await createRes.text();
        throw driveUploadError(createRes.status, createRes.statusText, errorText, `Creating "${fileName}" on Drive`, shouldRetryStatus(createRes.status), getRetryAfterMs(createRes));
    }

    const createData = await createRes.json();
    return createData.id;
}

async function simpleUploadAttempt(fileName, content, mimeType, fileId, token, onProgress, uploadContext, timeoutMs) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        if (uploadContext) {
            uploadContext.currentXhr = xhr;
            uploadContext.currentAbortController = null;
            if (typeof uploadContext.registerXhr === 'function') {
                uploadContext.registerXhr(xhr);
            }
        }

        const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,md5Checksum&supportsAllDrives=true`;
        xhr.open('PATCH', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.timeout = timeoutMs;

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(e.loaded, e.total);
                }
            });
        }

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    resolve({ id: response.id || fileId, skipped: false });
                } catch (e) {
                    reject(createUploadError('Failed to parse upload response', xhr.status, false));
                }
                return;
            }
            reject(driveUploadError(
                xhr.status,
                xhr.statusText,
                xhr.responseText,
                `Uploading "${fileName}"`,
                shouldRetryStatus(xhr.status),
                getRetryAfterMs(xhr)
            ));
        });

        xhr.addEventListener('error', () => {
            reject(driveUploadError(0, '', '', `Uploading "${fileName}"`, true));
        });

        xhr.addEventListener('abort', () => {
            reject(createUploadError(`Upload aborted: ${fileName}`, null, false));
        });

        xhr.addEventListener('timeout', () => {
            reject(createUploadError(`Upload timed out: ${fileName}`, 408, true));
        });

        xhr.send(content);
    });
}

async function createResumableSession(fileName, mimeType, fileId, totalSize, token) {
    const startRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=resumable&fields=id,md5Checksum&supportsAllDrives=true`,
        {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType,
                'X-Upload-Content-Length': String(totalSize)
            },
            body: JSON.stringify({})
        }
    );

    if (!startRes.ok) {
        const errorText = await startRes.text();
        throw driveUploadError(startRes.status, startRes.statusText, errorText, `Starting upload of "${fileName}"`, shouldRetryStatus(startRes.status), getRetryAfterMs(startRes));
    }

    const sessionUrl = startRes.headers.get('Location');
    if (!sessionUrl) {
        throw createUploadError('Missing resumable session URL', null, false);
    }
    return sessionUrl;
}

async function putResumableChunk(sessionUrl, chunkBuffer, start, end, total, committedBytes, onProgress, uploadContext, timeoutMs) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        if (uploadContext) {
            uploadContext.currentXhr = xhr;
            uploadContext.currentAbortController = null;
            if (typeof uploadContext.registerXhr === 'function') {
                uploadContext.registerXhr(xhr);
            }
        }

        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        xhr.timeout = timeoutMs;

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress(committedBytes + e.loaded, total);
                }
            });
        }

        xhr.addEventListener('load', () => {
            // 308 = resume incomplete; 200/201 = final complete
            if (xhr.status === 308 || (xhr.status >= 200 && xhr.status < 300)) {
                let parsed = null;
                if (xhr.responseText) {
                    try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
                }
                resolve({
                    done: xhr.status >= 200 && xhr.status < 300,
                    id: parsed?.id || null
                });
                return;
            }
            reject(driveUploadError(
                xhr.status,
                xhr.statusText,
                xhr.responseText,
                'Uploading file chunk',
                shouldRetryStatus(xhr.status),
                getRetryAfterMs(xhr)
            ));
        });

        xhr.addEventListener('error', () => {
            reject(driveUploadError(0, '', '', 'Uploading file chunk', true));
        });

        xhr.addEventListener('abort', () => {
            reject(createUploadError('Chunk upload aborted', null, false));
        });

        xhr.addEventListener('timeout', () => {
            reject(createUploadError('Chunk upload timed out', 408, true));
        });

        xhr.send(chunkBuffer);
    });
}

async function uploadResumableFromFile(fileName, fileInput, mimeType, fileId, token, onProgress, uploadContext) {
    if (typeof require === 'undefined') {
        throw createUploadError('Node.js fs is required for resumable file upload', null, false);
    }

    const fs = require('fs');
    const filePath = fileInput.filePath;
    const totalSize = getFileInputSize(fileInput);
    const sessionUrl = await createResumableSession(fileName, mimeType || 'application/octet-stream', fileId, totalSize, token);
    const timeoutMs = getDynamicTimeoutMs(totalSize);

    let fd = null;
    let committedBytes = 0;
    try {
        fd = fs.openSync(filePath, 'r');

        while (committedBytes < totalSize) {
            const chunkSize = Math.min(DRIVE_CHUNK_SIZE, totalSize - committedBytes);
            const chunkBuffer = Buffer.alloc(chunkSize);
            const bytesRead = fs.readSync(fd, chunkBuffer, 0, chunkSize, committedBytes);

            if (bytesRead <= 0) break;

            const effectiveChunk = bytesRead === chunkSize ? chunkBuffer : chunkBuffer.subarray(0, bytesRead);
            const start = committedBytes;
            const end = committedBytes + bytesRead - 1;

            let chunkUploaded = false;
            for (let attempt = 1; attempt <= DRIVE_MAX_RETRIES; attempt++) {
                try {
                    const chunkResult = await putResumableChunk(
                        sessionUrl,
                        effectiveChunk,
                        start,
                        end,
                        totalSize,
                        committedBytes,
                        onProgress,
                        uploadContext,
                        timeoutMs
                    );
                    committedBytes += bytesRead;
                    chunkUploaded = true;
                    if (chunkResult.done) {
                        return { id: chunkResult.id || fileId, skipped: false };
                    }
                    break;
                } catch (err) {
                    if (attempt >= DRIVE_MAX_RETRIES || !err.retriable) throw err;
                    const waitMs = buildRetryDelayMs(attempt, err.retryAfterMs);
                    console.warn(`Retrying chunk ${start}-${end} for ${fileName} in ${waitMs}ms (attempt ${attempt + 1}/${DRIVE_MAX_RETRIES})`);
                    await sleep(waitMs);
                }
            }

            if (!chunkUploaded) {
                throw createUploadError(`Failed to upload chunk for ${fileName}`, null, false);
            }
        }
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }

    return { id: fileId, skipped: false };
}

async function uploadFileWithProgress(fileName, fileInput, mimeType, folderId, onProgress = null, actualFileSize = null, uploadContext = null) {
    const token = await GoogleDrive.getValidToken();
    if (!token) throw new Error('Not authenticated');

    const inputSize = actualFileSize || getFileInputSize(fileInput);
    const logSizeMb = (inputSize / 1024 / 1024).toFixed(2);
    console.log(`📤 Starting upload: ${fileName} (${logSizeMb} MB)`);

    const existingFile = await findExistingDriveFile(fileName, folderId, token);
    let existingId = existingFile?.id;
    const localMd5 = await computeLocalMd5(fileInput);

    if (existingId && existingFile?.md5Checksum && localMd5 && existingFile.md5Checksum === localMd5) {
        console.log(`  ⏭️ Skipped ${fileName} (unchanged, MD5 match)`);
        return { id: existingId, skipped: true, reason: 'Unchanged (MD5 match)' };
    }

    existingId = await ensureDriveFileMetadata(fileName, folderId, token, existingId);

    const fileIsPathInput = fileInput && typeof fileInput === 'object' && !!fileInput.filePath;
    const shouldUseResumable = fileIsPathInput && inputSize >= DRIVE_RESUMABLE_THRESHOLD;
    const timeoutMs = getDynamicTimeoutMs(inputSize);

    if (shouldUseResumable) {
        console.log(`  📦 Using resumable upload for ${fileName}`);
        for (let attempt = 1; attempt <= DRIVE_MAX_RETRIES; attempt++) {
            try {
                return await uploadResumableFromFile(fileName, fileInput, mimeType, existingId, token, onProgress, uploadContext);
            } catch (err) {
                if (attempt >= DRIVE_MAX_RETRIES || !err.retriable) throw err;
                const waitMs = buildRetryDelayMs(attempt, err.retryAfterMs);
                console.warn(`Retrying resumable upload for ${fileName} in ${waitMs}ms (attempt ${attempt + 1}/${DRIVE_MAX_RETRIES})`);
                await sleep(waitMs);
            }
        }
    }

    const content = normalizeContent(fileInput);
    for (let attempt = 1; attempt <= DRIVE_MAX_RETRIES; attempt++) {
        try {
            return await simpleUploadAttempt(fileName, content, mimeType, existingId, token, onProgress, uploadContext, timeoutMs);
        } catch (err) {
            if (attempt >= DRIVE_MAX_RETRIES || !err.retriable) throw err;
            const waitMs = buildRetryDelayMs(attempt, err.retryAfterMs);
            console.warn(`Retrying upload for ${fileName} in ${waitMs}ms (attempt ${attempt + 1}/${DRIVE_MAX_RETRIES})`);
            await sleep(waitMs);
        }
    }

    throw new Error(`Upload failed for ${fileName}`);
}
