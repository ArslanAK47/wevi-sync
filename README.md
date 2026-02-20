# Premiere Pro Team Sync Extension

A lightweight extension for syncing Premiere Pro projects between editors with license management.

## 📁 Project Structure

```
adobe extension/
├── admin-server/              # Admin dashboard & license server
│   ├── public/                # Web dashboard files
│   │   ├── index.html
│   │   ├── css/styles.css
│   │   └── js/admin.js
│   ├── server.js              # Node.js server
│   └── package.json
│
└── premiere-extension/        # CEP Extension for Premiere Pro
    ├── CSXS/
    │   └── manifest.xml       # Extension manifest
    ├── client/
    │   ├── index.html
    │   ├── css/styles.css
    │   └── js/                # Extension logic
    ├── host/
    │   └── index.jsx          # ExtendScript
    └── .debug                 # Debug config
```

---

## 🚀 Quick Start

### Step 1: Start the Admin Server

```bash
cd admin-server
npm install
npm start
```

This will start the server at `http://localhost:3847`

**Default Login:** `admin` / `admin123`  
⚠️ Change this password after first login!

### Step 2: Enable CEP Debug Mode (One-Time Setup)

Run this in PowerShell as Administrator:

```powershell
# Enable unsigned extensions
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.10 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.9 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

### Step 3: Install the Extension

Copy the `premiere-extension` folder to:

**Windows:**
```
C:\Users\<USERNAME>\AppData\Roaming\Adobe\CEP\extensions\
```

Rename it to `com.premieresync.panel`

### Step 4: Restart Premiere Pro

1. Close Premiere Pro completely
2. Reopen Premiere Pro
3. Go to **Window → Extensions → Team Sync**

---

## 👑 Admin Dashboard

Access at: `http://localhost:3847`

### Features:
- **Generate API Keys** - Create keys for your editors
- **Set Expiry** - Keys auto-expire after X days
- **Revoke/Extend** - Control access instantly
- **Activity Log** - See who synced what and when
- **Project Locks** - View and force-unlock projects

---

## 🔑 For Editors

1. Open Premiere Pro
2. Window → Extensions → Team Sync
3. Enter your API key (from admin)
4. Set your sync folder (Google Drive shared folder)
5. Start syncing!

### Workflow:
1. **Lock** a project before editing (prevents conflicts)
2. **Edit** your project in Premiere
3. **Push** when done to share changes
4. **Unlock** to let others edit

---

## 📋 API Endpoints

### Admin Endpoints (require auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Login |
| POST | `/api/keys` | Generate new key |
| GET | `/api/keys` | List all keys |
| POST | `/api/keys/:key/revoke` | Revoke a key |
| POST | `/api/keys/:key/extend` | Extend a key |
| GET | `/api/activity` | Get activity log |
| GET | `/api/stats` | Dashboard stats |

### Editor Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/validate` | Validate API key |
| POST | `/api/activity` | Log an action |
| POST | `/api/projects/lock` | Lock a project |
| POST | `/api/projects/unlock` | Unlock a project |
| GET | `/api/projects/locks` | Get all locks |

---

## 🔧 Configuration

### Sync Folder
Use a shared Google Drive folder that all editors have access to.  
Example: `G:\My Drive\Team Projects`

### Port
Default: `3847`  
Change in `server.js` if needed.

---

## ❓ Troubleshooting

### Extension not appearing?
1. Ensure debug mode is enabled (see Step 2)
2. Check the folder is named correctly: `com.premieresync.panel`
3. Restart Premiere Pro completely

### Can't connect to server?
1. Make sure server is running (`npm start`)
2. Check firewall isn't blocking port 3847
3. Verify server URL in extension settings

### Extension showing errors?
Open Chrome DevTools for debugging:
1. Navigate to `http://localhost:8088` while Premiere is open
2. Click on the extension to debug

---

## 📝 License

MIT License - Free to use and modify.
