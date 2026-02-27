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
    clientId: '491312886441-9o9r8t8e935covla98fnb3lu2ce0c2ec.apps.googleusercontent.com',
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
