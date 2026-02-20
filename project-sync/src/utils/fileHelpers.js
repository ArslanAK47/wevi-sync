/**
 * File Helper Utilities
 */

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);

    return `${value.toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename) {
    if (!filename) return '';
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.substring(lastDot + 1).toLowerCase() : '';
}

/**
 * Sanitize filename for safe use
 */
export function sanitizeFilename(filename) {
    if (!filename) return 'untitled';
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 200);
}

/**
 * Get basename from path
 */
export function getBasename(filePath) {
    if (!filePath) return '';
    return filePath.split(/[/\\]/).pop() || '';
}

/**
 * Get directory from path
 */
export function getDirname(filePath) {
    if (!filePath) return '';
    const parts = filePath.split(/[/\\]/);
    parts.pop();
    return parts.join('/');
}
