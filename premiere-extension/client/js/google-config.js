/**
 * Google Drive Configuration - OAuth Loopback Flow
 * Uses Authorization Code flow with localhost redirect
 * This supports the full 'drive' scope (unlike Device Flow)
 */

const GoogleDriveConfig = {
    /**
     * OAuth 2.0 Credentials
     * Use a "Desktop App" type client in Google Cloud Console
     */
    clientId: '257286570354-m9rb40pa6bj3j13s6piu47qhphao2il5.apps.googleusercontent.com',
    clientSecret: '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',

    /**
     * OAuth Scopes - full Drive access for shared folder support
     */
    scopes: ['https://www.googleapis.com/auth/drive'],

    /**
     * Token Storage Key
     */
    tokenStorageKey: 'googleDriveToken',

    /**
     * Team Projects Folder ID
     * This is the shared "Projects" folder in Google Drive
     */
    teamProjectsFolderId: '1gu4cUxVIWQc4yc1zylfQQtom7z-86cuL',

    /**
     * Team Member Emails (for sharing notifications)
     * Configure these in your local installation
     */
    teamEmails: []
};
