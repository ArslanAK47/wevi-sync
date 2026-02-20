# Final Steps to Complete OAuth Integration

## ✅ What's Already Done
- ✅ `google-config.js` - OAuth credentials added
- ✅ `google-drive.js` - OAuth methods implemented
- ✅ Upload system ready

## 📝 Manual Steps Required

### Step 1: Update index.html

Open `e:\adobe extension\premiere-extension\client\index.html`

**Find the activation screen section** (around line 15-33) and make sure it has:

1. Update the `btn-google-connect` button text from "Run Diagnostic Test" to "Connect Google Drive"
2. Add a device code display section

**Add this HTML right after the closing `</div>` of `auth-connect`:**

```html
<!-- Device Code Display -->
<div id="auth-device-code" class="auth-section hidden">
    <div class="auth-status-box">
        <p class="auth-status-text">Waiting for authorization...</p>
        <p class="auth-detail">Go to: <a id="verification-url" href="#" target="_blank" style="color: var(--accent);">google.com/device</a></p>
        <div style="margin: 20px 0; padding: 16px; background: var(--bg-secondary); border-radius: 8px; text-align: center;">
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 8px;">Enter this code:</div>
            <strong id="device-code" style="font-size: 24px; letter-spacing: 4px; font-family: monospace;">XXXX-XXXX</strong>
        </div>
    </div>
    <button id="btn-cancel-auth" class="btn btn-secondary btn-full" style="margin-top: 16px;">
        Cancel
    </button>
</div>
```

### Step 2: Update main.js

Open `e:\adobe extension\premiere-extension\client\js\main.js`

**Find the `setupEventListeners()` function** (around line 106) and **add these lines at the very beginning:**

```javascript
function setupEventListeners() {
    // OAuth buttons - ADD THESE LINES
    const btnGoogleConnect = document.getElementById('btn-google-connect');
    const btnCancelAuth = document.getElementById('btn-cancel-auth');
    
    if (btnGoogleConnect) {
        btnGoogleConnect.addEventListener('click', handleGoogleConnect);
    }
    if (btnCancelAuth) {
        btnCancelAuth.addEventListener('click', handleCancelAuth);
    }
    // END OAuth buttons

    // ... rest of existing code ...
```

### Step 3: Update DOMContentLoaded handler

**Find the `document.addEventListener('DOMContentLoaded'` section** (around line 70) and **replace the auth check with:**

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Extension loaded');

    const authStatus = document.getElementById('auth-status');
    const authDetail = document.getElementById('auth-detail');

    try {
        // Check if user is already authenticated
        const isAuth = await GoogleDrive.isAuthenticated();
        
        if (isAuth) {
            // User has valid token, show main panel
            authStatus.textContent = '✅ Connected to Google Drive';
            authDetail.textContent = 'Loading...';
            
            setTimeout(() => {
                showMainPanel();
                initializeSync();
            }, 1000);
        } else {
            // Show activation screen for login
            authStatus.textContent = 'Connect to Google Drive';
            authDetail.textContent = 'Click the button below to get started';
        }
    } catch (error) {
        console.error('Auth check error:', error);
        authStatus.textContent = 'Connect to Google Drive';
        authDetail.textContent = 'Click the button below to get started';
    }

    setupEventListeners();
});
```

## 🧪 Testing

After making these changes:

1. **Reload the extension** in Premiere Pro
2. You should see "Connect to Google Drive" button
3. Click it → Get a code
4. Go to google.com/device → Enter code
5. Authorize → Extension detects it automatically
6. Main panel appears!

## ⚠️ Note

The `handleGoogleConnect` and `handleCancelAuth` functions **already exist** in your main.js file (lines 284-344), so you don't need to add them - just wire them up to the buttons!
