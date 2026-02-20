# Project Sync - UXP Extension

Premiere Pro extension for syncing projects with team via Google Drive.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Build the extension:
   ```
   npm run build
   ```

3. For development (auto-rebuild):
   ```
   npm run watch
   ```

## Loading in Premiere Pro

1. Open **UXP Developer Tool** (Adobe UXP Developer Tool)
2. Click **"Add Plugin"** → Select the `manifest.json` in this folder
3. Click **"Load"** to load it in Premiere Pro
4. Find the panel under **Window → Extensions → Project Sync**

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Enable **Google Drive API**
4. Create OAuth consent screen (Testing mode)
5. Add test users (your email + team emails)
6. Create OAuth 2.0 credentials (Desktop app)
7. Copy Client ID to `src/services/authService.js`

## Features

- **Push**: Upload .prproj + manifest to Google Drive
- **Device Flow Auth**: No browser redirect needed
- **Project Info**: Shows current project details

## Coming Soon

- Download/Pull projects
- Lock system for collaboration
- Full media sync
