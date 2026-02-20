/**
 * Premiere Pro API Service
 * Interfaces with Premiere Pro via UXP API
 */

import { formatBytes, getBasename } from '../utils/fileHelpers';

// Check if we're in UXP environment
const isUXP = typeof require !== 'undefined';

/**
 * Get current project data from Premiere Pro
 */
export async function getProjectData() {
    try {
        if (!isUXP) {
            // Mock data for development outside Premiere
            return getMockProjectData();
        }

        const { app } = require('uxp').host;

        if (!app || !app.project) {
            return null;
        }

        const project = app.project;

        // Get media files
        const mediaFiles = await getAllMediaFiles(project.rootItem);
        const totalSize = mediaFiles.reduce((sum, f) => sum + (f.size || 0), 0);

        return {
            name: project.name || 'Untitled',
            path: project.path || '',
            mediaCount: mediaFiles.length,
            mediaFiles: mediaFiles,
            mediaSize: formatBytes(totalSize)
        };
    } catch (error) {
        console.error('Error getting project data:', error);
        return null;
    }
}

/**
 * Recursively get all media files from project
 */
async function getAllMediaFiles(rootItem) {
    const mediaFiles = [];

    async function traverse(item) {
        if (!item || !item.children) return;

        const numChildren = item.children.numItems || 0;

        for (let i = 0; i < numChildren; i++) {
            const child = item.children[i];

            if (child.type === 1) {
                // Footage item
                try {
                    const mediaPath = child.getMediaPath ? child.getMediaPath() : '';
                    mediaFiles.push({
                        name: child.name || 'Unknown',
                        path: mediaPath,
                        type: getMediaType(child.name || ''),
                        size: 0 // Size would need file system access
                    });
                } catch (e) {
                    console.log('Could not get media path for:', child.name);
                }
            } else if (child.type === 2) {
                // Bin/folder - recurse
                await traverse(child);
            }
        }
    }

    await traverse(rootItem);
    return mediaFiles;
}

/**
 * Determine media type from filename
 */
function getMediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase();

    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mxf'];
    const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'aiff'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'psd', 'ai'];

    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (imageExts.includes(ext)) return 'image';
    return 'other';
}

/**
 * Save the current project
 */
export async function saveProject() {
    try {
        if (!isUXP) {
            console.log('Mock: Project saved');
            return true;
        }

        const { app } = require('uxp').host;
        if (app && app.project) {
            await app.project.save();
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving project:', error);
        return false;
    }
}

/**
 * Mock data for development
 */
function getMockProjectData() {
    return {
        name: 'TestProject.prproj',
        path: 'C:/Projects/TestProject/TestProject.prproj',
        mediaCount: 5,
        mediaFiles: [
            { name: 'interview.mp4', path: 'C:/Projects/TestProject/Media/interview.mp4', type: 'video' },
            { name: 'broll.mp4', path: 'C:/Projects/TestProject/Media/broll.mp4', type: 'video' },
            { name: 'music.mp3', path: 'C:/Projects/TestProject/Audio/music.mp3', type: 'audio' },
        ],
        mediaSize: '1.2 GB'
    };
}
