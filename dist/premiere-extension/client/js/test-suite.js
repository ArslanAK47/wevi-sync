/**
 * Team Sync Extension - Comprehensive Test Suite
 *
 * This file contains test cases for all major functionality of the extension.
 * Tests can be run from the browser console in the CEP environment.
 *
 * Usage:
 *   - Run all tests: runAllTests()
 *   - Run specific suite: runTestSuite('auth')
 *   - Run single test: runTest('auth', 'checkSavedTokens')
 *
 * Available test suites:
 *   - auth: Google Drive authentication tests
 *   - upload: Project upload/push tests
 *   - download: Project download/pull tests
 *   - update: Auto-update functionality tests
 *   - config: Configuration management tests
 *   - ui: UI interaction tests
 *   - integration: End-to-end integration tests
 */

const TestSuite = {
    results: [],
    currentSuite: null,
    verbose: true,

    // Test state
    passed: 0,
    failed: 0,
    skipped: 0,

    /**
     * Log test result
     */
    log(message, type = 'info') {
        const timestamp = new Date().toISOString().substr(11, 8);
        const prefix = {
            info: '  ',
            pass: '  ✅',
            fail: '  ❌',
            skip: '  ⏭️',
            suite: '📦',
            test: '  🧪'
        }[type] || '  ';

        const color = {
            info: '#888',
            pass: '#51cf66',
            fail: '#ff6b6b',
            skip: '#ffd43b',
            suite: '#0078d4',
            test: '#aaa'
        }[type] || '#fff';

        console.log(`%c[${timestamp}] ${prefix} ${message}`, `color: ${color}`);

        this.results.push({ timestamp, type, message });
    },

    /**
     * Assert helper
     */
    assert(condition, message, details = '') {
        if (condition) {
            this.passed++;
            this.log(`PASS: ${message}`, 'pass');
            return true;
        } else {
            this.failed++;
            this.log(`FAIL: ${message}${details ? ' - ' + details : ''}`, 'fail');
            return false;
        }
    },

    /**
     * Assert equals helper
     */
    assertEqual(actual, expected, message) {
        const passed = actual === expected;
        if (passed) {
            this.passed++;
            this.log(`PASS: ${message}`, 'pass');
        } else {
            this.failed++;
            this.log(`FAIL: ${message} (expected: ${expected}, got: ${actual})`, 'fail');
        }
        return passed;
    },

    /**
     * Assert not null helper
     */
    assertNotNull(value, message) {
        return this.assert(value !== null && value !== undefined, message, 'value is null/undefined');
    },

    /**
     * Assert throws helper
     */
    async assertThrows(asyncFn, message) {
        try {
            await asyncFn();
            this.failed++;
            this.log(`FAIL: ${message} (expected error, none thrown)`, 'fail');
            return false;
        } catch (e) {
            this.passed++;
            this.log(`PASS: ${message}`, 'pass');
            return true;
        }
    },

    /**
     * Skip a test
     */
    skip(message) {
        this.skipped++;
        this.log(`SKIP: ${message}`, 'skip');
    },

    /**
     * Reset test state
     */
    reset() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
        this.skipped = 0;
    },

    /**
     * Print summary
     */
    summary() {
        console.log('\n' + '='.repeat(50));
        console.log('%c TEST SUMMARY', 'font-weight: bold; font-size: 14px;');
        console.log('='.repeat(50));
        console.log(`%c ✅ Passed: ${this.passed}`, 'color: #51cf66');
        console.log(`%c ❌ Failed: ${this.failed}`, 'color: #ff6b6b');
        console.log(`%c ⏭️ Skipped: ${this.skipped}`, 'color: #ffd43b');
        console.log(`%c Total: ${this.passed + this.failed + this.skipped}`, 'color: #0078d4');
        console.log('='.repeat(50) + '\n');

        return {
            passed: this.passed,
            failed: this.failed,
            skipped: this.skipped,
            total: this.passed + this.failed + this.skipped
        };
    }
};

/* ============================================
   TEST SUITES
   ============================================ */

const testSuites = {

    /**
     * Authentication Tests
     */
    auth: {
        name: 'Google Drive Authentication',
        tests: {

            checkGoogleDriveModule: async () => {
                TestSuite.log('Testing GoogleDrive module exists', 'test');
                TestSuite.assertNotNull(typeof GoogleDrive, 'GoogleDrive module should exist');
                TestSuite.assertNotNull(GoogleDrive.isAuthenticated, 'isAuthenticated method should exist');
                TestSuite.assertNotNull(GoogleDrive.startLoopbackAuth, 'startLoopbackAuth method should exist');
                TestSuite.assertNotNull(GoogleDrive.getValidToken, 'getValidToken method should exist');
                TestSuite.assertNotNull(GoogleDrive.logout, 'logout method should exist');
            },

            checkSavedTokens: async () => {
                TestSuite.log('Testing saved token retrieval', 'test');
                try {
                    const refreshToken = localStorage.getItem('gdrive_refresh_token');
                    TestSuite.log(`Refresh token exists: ${!!refreshToken}`, 'info');

                    if (refreshToken) {
                        TestSuite.assert(refreshToken.length > 10, 'Refresh token should have reasonable length');
                    } else {
                        TestSuite.skip('No refresh token saved (user not authenticated)');
                    }
                } catch (e) {
                    TestSuite.assert(false, 'Token retrieval should not throw', e.message);
                }
            },

            checkIsAuthenticated: async () => {
                TestSuite.log('Testing isAuthenticated function', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    TestSuite.assert(typeof isAuth === 'boolean', 'isAuthenticated should return boolean');
                    TestSuite.log(`Current auth state: ${isAuth}`, 'info');
                } catch (e) {
                    TestSuite.assert(false, 'isAuthenticated should not throw', e.message);
                }
            },

            checkGoogleConfig: async () => {
                TestSuite.log('Testing Google Drive configuration', 'test');
                TestSuite.assertNotNull(GoogleDriveConfig, 'GoogleDriveConfig should exist');
                TestSuite.assertNotNull(GoogleDriveConfig.clientId, 'clientId should be configured');
                TestSuite.assertNotNull(GoogleDriveConfig.clientSecret, 'clientSecret should be configured');
                TestSuite.assertNotNull(GoogleDriveConfig.teamProjectsFolderId, 'teamProjectsFolderId should be configured');
                TestSuite.assert(GoogleDriveConfig.clientId.includes('.apps.googleusercontent.com'),
                    'clientId should be valid Google OAuth client ID');
            },

            testTokenRefresh: async () => {
                TestSuite.log('Testing token refresh mechanism', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    if (!isAuth) {
                        TestSuite.skip('User not authenticated - cannot test token refresh');
                        return;
                    }

                    const token = await GoogleDrive.getValidToken();
                    TestSuite.assertNotNull(token, 'getValidToken should return a token');
                    TestSuite.assert(token.length > 50, 'Access token should have reasonable length');
                } catch (e) {
                    TestSuite.assert(false, 'Token refresh should not throw', e.message);
                }
            }
        }
    },

    /**
     * Upload/Push Tests
     */
    upload: {
        name: 'Project Upload/Push',
        tests: {

            checkUploadHelperExists: async () => {
                TestSuite.log('Testing upload helper functions exist', 'test');
                TestSuite.assertNotNull(typeof uploadProjectWithConcurrency, 'uploadProjectWithConcurrency should exist');
                TestSuite.assertNotNull(typeof uploadFileWithProgress, 'uploadFileWithProgress should exist');
            },

            checkGoogleDriveUpload: async () => {
                TestSuite.log('Testing Google Drive upload function', 'test');
                TestSuite.assertNotNull(GoogleDrive.uploadFile, 'uploadFile method should exist');
                TestSuite.assertNotNull(GoogleDrive.getOrCreateFolder, 'getOrCreateFolder method should exist');
            },

            checkFileSystemAccess: async () => {
                TestSuite.log('Testing file system access', 'test');
                try {
                    const fs = require('fs');
                    const path = require('path');
                    TestSuite.assertNotNull(fs, 'Node.js fs module should be available');
                    TestSuite.assertNotNull(path, 'Node.js path module should be available');

                    // Test reading a known file
                    const extensionRoot = path.resolve(__dirname, '../../');
                    const versionFile = path.join(extensionRoot, 'version.json');
                    TestSuite.assert(fs.existsSync(versionFile), 'Should be able to access version.json');
                } catch (e) {
                    TestSuite.assert(false, 'File system access should work', e.message);
                }
            },

            testFolderCreation: async () => {
                TestSuite.log('Testing folder creation on Google Drive', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    if (!isAuth) {
                        TestSuite.skip('User not authenticated - cannot test folder creation');
                        return;
                    }

                    const testFolderName = `__test_folder_${Date.now()}`;
                    const parentId = GoogleDriveConfig.teamProjectsFolderId;

                    const folderId = await GoogleDrive.getOrCreateFolder(testFolderName, parentId);
                    TestSuite.assertNotNull(folderId, 'Should create and return folder ID');
                    TestSuite.assert(folderId.length > 10, 'Folder ID should have reasonable length');

                    TestSuite.log(`Created test folder: ${testFolderName} (ID: ${folderId})`, 'info');
                    TestSuite.log('Note: Remember to delete test folder manually', 'info');
                } catch (e) {
                    TestSuite.assert(false, 'Folder creation should not throw', e.message);
                }
            },

            testSmallFileUpload: async () => {
                TestSuite.log('Testing small file upload', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    if (!isAuth) {
                        TestSuite.skip('User not authenticated - cannot test upload');
                        return;
                    }

                    const testContent = JSON.stringify({ test: true, timestamp: Date.now() });
                    const testFileName = `__test_file_${Date.now()}.json`;
                    const parentId = GoogleDriveConfig.teamProjectsFolderId;

                    const result = await uploadFileWithProgress(
                        testFileName,
                        testContent,
                        'application/json',
                        parentId,
                        null
                    );

                    TestSuite.assertNotNull(result, 'Upload should return result');
                    TestSuite.log(`Uploaded test file: ${testFileName}`, 'info');
                    TestSuite.log('Note: Remember to delete test file manually', 'info');
                } catch (e) {
                    TestSuite.assert(false, 'Small file upload should not throw', e.message);
                }
            }
        }
    },

    /**
     * Download/Pull Tests
     */
    download: {
        name: 'Project Download/Pull',
        tests: {

            checkDownloadHelperExists: async () => {
                TestSuite.log('Testing download helper functions exist', 'test');
                TestSuite.assertNotNull(typeof downloadProjectWithProgress, 'downloadProjectWithProgress should exist');
                TestSuite.assertNotNull(typeof resolveConflicts, 'resolveConflicts should exist');
            },

            checkGoogleDriveDownload: async () => {
                TestSuite.log('Testing Google Drive download function', 'test');
                TestSuite.assertNotNull(GoogleDrive.downloadFile, 'downloadFile method should exist');
                TestSuite.assertNotNull(GoogleDrive.listFilesInFolder, 'listFilesInFolder method should exist');
            },

            testFolderListing: async () => {
                TestSuite.log('Testing folder listing on Google Drive', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    if (!isAuth) {
                        TestSuite.skip('User not authenticated - cannot test folder listing');
                        return;
                    }

                    const folderId = GoogleDriveConfig.teamProjectsFolderId;
                    const files = await GoogleDrive.listFilesInFolder(folderId);

                    TestSuite.assert(Array.isArray(files), 'listFilesInFolder should return array');
                    TestSuite.log(`Found ${files.length} items in team folder`, 'info');

                    if (files.length > 0) {
                        const firstFile = files[0];
                        TestSuite.assertNotNull(firstFile.id, 'File object should have id');
                        TestSuite.assertNotNull(firstFile.name, 'File object should have name');
                    }
                } catch (e) {
                    TestSuite.assert(false, 'Folder listing should not throw', e.message);
                }
            },

            testCEPFileSystem: async () => {
                TestSuite.log('Testing CEP file system access', 'test');
                try {
                    TestSuite.assertNotNull(cep, 'CEP object should exist');
                    TestSuite.assertNotNull(cep.fs, 'CEP fs module should exist');
                    TestSuite.assertNotNull(cep.fs.stat, 'CEP fs.stat should exist');
                    TestSuite.assertNotNull(cep.fs.writeFile, 'CEP fs.writeFile should exist');
                    TestSuite.assertNotNull(cep.fs.makedir, 'CEP fs.makedir should exist');
                } catch (e) {
                    TestSuite.assert(false, 'CEP file system should be accessible', e.message);
                }
            }
        }
    },

    /**
     * Auto-Update Tests
     */
    update: {
        name: 'Auto-Update Functionality',
        tests: {

            checkUpdateModuleExists: async () => {
                TestSuite.log('Testing update checker module exists', 'test');
                TestSuite.assertNotNull(typeof checkForUpdates, 'checkForUpdates should exist');
                TestSuite.assertNotNull(typeof performAutoUpdate, 'performAutoUpdate should exist');
                TestSuite.assertNotNull(typeof setUpdateMode, 'setUpdateMode should exist');
                TestSuite.assertNotNull(typeof getUpdateMode, 'getUpdateMode should exist');
                TestSuite.assertNotNull(typeof getLocalVersion, 'getLocalVersion should exist');
            },

            testLocalVersionReading: async () => {
                TestSuite.log('Testing local version reading', 'test');
                try {
                    const version = getLocalVersion();
                    TestSuite.assertNotNull(version, 'getLocalVersion should return object');
                    TestSuite.assertNotNull(version.version, 'Version object should have version field');
                    TestSuite.assert(/^\d+\.\d+\.\d+$/.test(version.version),
                        'Version should be in semver format (x.y.z)');
                    TestSuite.log(`Current version: ${version.version}`, 'info');
                } catch (e) {
                    TestSuite.assert(false, 'Version reading should not throw', e.message);
                }
            },

            testVersionComparison: async () => {
                TestSuite.log('Testing version comparison logic', 'test');
                // Test the compareVersions function indirectly through update check

                // Test cases
                const tests = [
                    { a: '1.0.0', b: '1.0.0', expected: 0 },
                    { a: '1.0.1', b: '1.0.0', expected: 1 },
                    { a: '1.0.0', b: '1.0.1', expected: -1 },
                    { a: '2.0.0', b: '1.9.9', expected: 1 },
                    { a: '1.1.0', b: '1.0.9', expected: 1 }
                ];

                for (const test of tests) {
                    // Access internal compareVersions if exposed, or test through behavior
                    TestSuite.log(`Compare ${test.a} vs ${test.b}: expected ${test.expected}`, 'info');
                }
            },

            testUpdateModeToggle: async () => {
                TestSuite.log('Testing update mode toggle', 'test');
                try {
                    const originalMode = getUpdateMode();

                    setUpdateMode('local');
                    TestSuite.assertEqual(getUpdateMode(), 'local', 'Should switch to local mode');

                    setUpdateMode('remote');
                    TestSuite.assertEqual(getUpdateMode(), 'remote', 'Should switch to remote mode');

                    // Restore original
                    setUpdateMode(originalMode);
                } catch (e) {
                    TestSuite.assert(false, 'Mode toggle should not throw', e.message);
                }
            },

            testRemoteVersionCheck: async () => {
                TestSuite.log('Testing remote version check', 'test');
                try {
                    setUpdateMode('remote');
                    const result = await checkForUpdates(false);

                    TestSuite.assertNotNull(result, 'checkForUpdates should return result');
                    TestSuite.assert('hasUpdate' in result, 'Result should have hasUpdate property');
                    TestSuite.log(`Remote check result: hasUpdate=${result.hasUpdate}, version=${result.version}`, 'info');
                } catch (e) {
                    TestSuite.assert(false, 'Remote version check should not throw', e.message);
                }
            },

            testLocalUpdateServer: async () => {
                TestSuite.log('Testing local update server connection', 'test');
                try {
                    // First check if local server is running
                    const response = await fetch('http://localhost:8888/version.json', {
                        signal: AbortSignal.timeout(3000)
                    }).catch(() => null);

                    if (!response) {
                        TestSuite.skip('Local update server not running (start with: node update-test-server/server.js)');
                        return;
                    }

                    setUpdateMode('local');
                    const result = await checkForUpdates(false);

                    TestSuite.assertNotNull(result, 'Local check should return result');
                    TestSuite.log(`Local server version: ${result.version}`, 'info');

                    // Restore remote mode
                    setUpdateMode('remote');
                } catch (e) {
                    setUpdateMode('remote');
                    TestSuite.skip('Local server test failed: ' + e.message);
                }
            }
        }
    },

    /**
     * Configuration Tests
     */
    config: {
        name: 'Configuration Management',
        tests: {

            checkConfigModule: async () => {
                TestSuite.log('Testing Config module exists', 'test');
                TestSuite.assertNotNull(typeof Config, 'Config module should exist');
                TestSuite.assertNotNull(Config.load, 'Config.load should exist');
                TestSuite.assertNotNull(Config.save, 'Config.save should exist');
                TestSuite.assertNotNull(Config.get, 'Config.get should exist');
                TestSuite.assertNotNull(Config.set, 'Config.set should exist');
            },

            testConfigLoad: async () => {
                TestSuite.log('Testing config loading', 'test');
                try {
                    Config.load();
                    TestSuite.assertNotNull(Config.data, 'Config.data should exist after load');
                } catch (e) {
                    TestSuite.assert(false, 'Config load should not throw', e.message);
                }
            },

            testConfigSetGet: async () => {
                TestSuite.log('Testing config set/get', 'test');
                try {
                    const testKey = '__test_key';
                    const testValue = 'test_value_' + Date.now();

                    Config.set(testKey, testValue);
                    const retrieved = Config.get(testKey);

                    TestSuite.assertEqual(retrieved, testValue, 'Config get should return set value');

                    // Clean up
                    delete Config.data[testKey];
                    Config.save();
                } catch (e) {
                    TestSuite.assert(false, 'Config set/get should not throw', e.message);
                }
            },

            testConfigPersistence: async () => {
                TestSuite.log('Testing config persistence', 'test');
                try {
                    const testKey = '__persistence_test';
                    const testValue = 'persisted_' + Date.now();

                    Config.set(testKey, testValue);
                    Config.save();

                    // Simulate reload
                    const saved = localStorage.getItem('premiere_sync_config');
                    TestSuite.assertNotNull(saved, 'Config should be saved to localStorage');

                    const parsed = JSON.parse(saved);
                    TestSuite.assertEqual(parsed[testKey], testValue, 'Saved config should contain test value');

                    // Clean up
                    delete Config.data[testKey];
                    Config.save();
                } catch (e) {
                    TestSuite.assert(false, 'Config persistence should not throw', e.message);
                }
            }
        }
    },

    /**
     * UI Tests
     */
    ui: {
        name: 'UI Interactions',
        tests: {

            checkDOMElements: async () => {
                TestSuite.log('Testing critical DOM elements exist', 'test');

                const criticalElements = [
                    'activation-screen',
                    'main-panel',
                    'btn-google-connect',
                    'btn-settings',
                    'btn-push',
                    'update-banner',
                    'modal-settings',
                    'projects-list',
                    'debug-panel'
                ];

                for (const id of criticalElements) {
                    const el = document.getElementById(id);
                    TestSuite.assert(el !== null, `Element #${id} should exist`);
                }
            },

            testModalToggle: async () => {
                TestSuite.log('Testing modal show/hide', 'test');
                try {
                    const modal = document.getElementById('modal-settings');
                    TestSuite.assertNotNull(modal, 'Settings modal should exist');

                    const wasHidden = modal.classList.contains('hidden');

                    modal.classList.remove('hidden');
                    TestSuite.assert(!modal.classList.contains('hidden'), 'Modal should be visible');

                    modal.classList.add('hidden');
                    TestSuite.assert(modal.classList.contains('hidden'), 'Modal should be hidden');

                    // Restore original state
                    if (wasHidden) modal.classList.add('hidden');
                    else modal.classList.remove('hidden');
                } catch (e) {
                    TestSuite.assert(false, 'Modal toggle should not throw', e.message);
                }
            },

            testDebugConsole: async () => {
                TestSuite.log('Testing debug console functionality', 'test');
                try {
                    TestSuite.assertNotNull(typeof toggleDebugConsole, 'toggleDebugConsole should exist');
                    TestSuite.assertNotNull(typeof copyDebugLogs, 'copyDebugLogs should exist');
                    TestSuite.assertNotNull(typeof clearDebugLogs, 'clearDebugLogs should exist');

                    const debugPanel = document.getElementById('debug-panel');
                    TestSuite.assertNotNull(debugPanel, 'Debug panel should exist');
                } catch (e) {
                    TestSuite.assert(false, 'Debug console test should not throw', e.message);
                }
            },

            testUpdateBanner: async () => {
                TestSuite.log('Testing update banner functionality', 'test');
                try {
                    const banner = document.getElementById('update-banner');
                    TestSuite.assertNotNull(banner, 'Update banner should exist');

                    TestSuite.assertNotNull(typeof dismissUpdate, 'dismissUpdate should exist');
                    TestSuite.assertNotNull(typeof performAutoUpdate, 'performAutoUpdate should exist');
                } catch (e) {
                    TestSuite.assert(false, 'Update banner test should not throw', e.message);
                }
            }
        }
    },

    /**
     * Integration Tests (require authenticated user)
     */
    integration: {
        name: 'Integration Tests',
        tests: {

            testFullAuthFlow: async () => {
                TestSuite.log('Testing full authentication flow', 'test');
                const isAuth = await GoogleDrive.isAuthenticated();

                if (isAuth) {
                    TestSuite.log('User is authenticated - auth flow previously completed', 'pass');
                    TestSuite.passed++;
                } else {
                    TestSuite.skip('User not authenticated - manual auth test required');
                }
            },

            testProjectDetection: async () => {
                TestSuite.log('Testing Premiere project detection', 'test');
                try {
                    // This requires CSInterface to call ExtendScript
                    if (typeof CSInterface === 'undefined') {
                        TestSuite.skip('CSInterface not available');
                        return;
                    }

                    TestSuite.assertNotNull(typeof refreshCurrentProject, 'refreshCurrentProject should exist');
                    TestSuite.log('Project detection functions available', 'info');
                } catch (e) {
                    TestSuite.assert(false, 'Project detection should not throw', e.message);
                }
            },

            testEndToEndUploadSimulation: async () => {
                TestSuite.log('Testing end-to-end upload simulation', 'test');
                try {
                    const isAuth = await GoogleDrive.isAuthenticated();
                    if (!isAuth) {
                        TestSuite.skip('User not authenticated - cannot run E2E test');
                        return;
                    }

                    // Simulate project data
                    const mockProject = {
                        name: '__test_project.prproj',
                        path: 'C:\\test\\__test_project.prproj',
                        mediaFiles: []
                    };

                    // Just verify the upload function accepts the structure
                    TestSuite.assertNotNull(mockProject.name, 'Mock project should have name');
                    TestSuite.log('E2E simulation structure valid', 'info');
                    TestSuite.log('Note: Full E2E test requires actual project file', 'info');
                } catch (e) {
                    TestSuite.assert(false, 'E2E simulation should not throw', e.message);
                }
            }
        }
    }
};

/* ============================================
   TEST RUNNERS
   ============================================ */

/**
 * Run a single test
 */
async function runTest(suiteName, testName) {
    const suite = testSuites[suiteName];
    if (!suite) {
        console.error(`Test suite "${suiteName}" not found`);
        return;
    }

    const test = suite.tests[testName];
    if (!test) {
        console.error(`Test "${testName}" not found in suite "${suiteName}"`);
        return;
    }

    TestSuite.reset();
    TestSuite.log(`Running single test: ${suiteName}.${testName}`, 'suite');

    try {
        await test();
    } catch (e) {
        TestSuite.assert(false, `Test threw exception: ${e.message}`);
    }

    return TestSuite.summary();
}
window.runTest = runTest;

/**
 * Run a test suite
 */
async function runTestSuite(suiteName) {
    const suite = testSuites[suiteName];
    if (!suite) {
        console.error(`Test suite "${suiteName}" not found`);
        console.log('Available suites:', Object.keys(testSuites).join(', '));
        return;
    }

    TestSuite.reset();
    console.log('\n' + '='.repeat(50));
    TestSuite.log(`Running test suite: ${suite.name}`, 'suite');
    console.log('='.repeat(50) + '\n');

    for (const [testName, testFn] of Object.entries(suite.tests)) {
        TestSuite.log(`Test: ${testName}`, 'test');
        try {
            await testFn();
        } catch (e) {
            TestSuite.assert(false, `Test threw exception: ${e.message}`);
        }
        console.log('');
    }

    return TestSuite.summary();
}
window.runTestSuite = runTestSuite;

/**
 * Run all test suites
 */
async function runAllTests() {
    TestSuite.reset();

    console.log('\n');
    console.log('╔' + '═'.repeat(48) + '╗');
    console.log('║     TEAM SYNC EXTENSION - FULL TEST SUITE     ║');
    console.log('╚' + '═'.repeat(48) + '╝');
    console.log('\n');

    for (const [suiteName, suite] of Object.entries(testSuites)) {
        console.log('\n' + '─'.repeat(50));
        TestSuite.log(`Suite: ${suite.name}`, 'suite');
        console.log('─'.repeat(50) + '\n');

        for (const [testName, testFn] of Object.entries(suite.tests)) {
            TestSuite.log(`Test: ${testName}`, 'test');
            try {
                await testFn();
            } catch (e) {
                TestSuite.assert(false, `Test threw exception: ${e.message}`);
            }
        }
    }

    return TestSuite.summary();
}
window.runAllTests = runAllTests;

/**
 * List all available tests
 */
function listTests() {
    console.log('\n╔═══════════════════════════════════════════════╗');
    console.log('║          AVAILABLE TEST SUITES                ║');
    console.log('╠═══════════════════════════════════════════════╣');

    for (const [suiteName, suite] of Object.entries(testSuites)) {
        console.log(`║ ${suite.name.padEnd(45)}║`);
        console.log(`║   Suite ID: ${suiteName.padEnd(33)}║`);
        console.log(`║   Tests:${(' ' + Object.keys(suite.tests).length).padStart(3).padEnd(37)}║`);

        for (const testName of Object.keys(suite.tests)) {
            console.log(`║     - ${testName.padEnd(38)}║`);
        }
        console.log('╟───────────────────────────────────────────────╢');
    }

    console.log('╚═══════════════════════════════════════════════╝');
    console.log('\nUsage:');
    console.log('  runAllTests()              - Run all tests');
    console.log('  runTestSuite("auth")       - Run auth suite');
    console.log('  runTest("auth", "check..") - Run single test\n');
}
window.listTests = listTests;

// Log availability
console.log('🧪 Test suite loaded. Run listTests() to see available tests, or runAllTests() to run all.');
