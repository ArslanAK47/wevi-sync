/**
 * Config Management for Premiere Sync
 * Handles persistence of settings to localStorage
 */

const Config = {
    // Default settings
    data: {
        syncFolder: '',
        editorName: '',
        serverUrl: 'http://localhost:3000',
        autoSync: false,
        lastSync: null,
        includeProjectMediaOnPush: true
    },

    storageKey: 'premiere_sync_config',

    /**
     * Load settings from localStorage
     */
    load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults to ensure all keys exist
                this.data = { ...this.data, ...parsed };
                console.log('📄 Config loaded:', this.data);
            }
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    },

    /**
     * Save settings to localStorage
     */
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            console.log('💾 Config saved');
        } catch (e) {
            console.error('Failed to save config:', e);
        }
    },

    /**
     * Get a setting value
     */
    get(key) {
        return this.data[key];
    },

    /**
     * Set a setting value and save
     */
    set(key, value) {
        this.data[key] = value;
        this.save();
    },

    /**
     * Clear all settings
     */
    clear() {
        localStorage.removeItem(this.storageKey);
        this.data = {
            syncFolder: '',
            editorName: '',
            serverUrl: 'http://localhost:3000',
            autoSync: false,
            lastSync: null,
            includeProjectMediaOnPush: true
        };
        console.log('🧹 Config cleared');
    }
};
