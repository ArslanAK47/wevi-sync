/* ============================================
   TEST SERVICE ACCOUNT AUTHENTICATION
   ============================================
   
   Run this in Premiere Pro's CEP extension to test
   if service account auth is working properly.
   ============================================ */

async function testServiceAccountAuth() {
    console.log('=== Testing Service Account Authentication ===');

    try {
        // Test 1: Configuration check
        console.log('\n1️⃣ Testing configuration...');
        if (!GoogleDriveConfig.isConfigured()) {
            console.error('❌ Configuration incomplete!');
            return;
        }
        console.log('✅ Configuration valid');

        // Test 2: JWT Token Generation
        console.log('\n2️⃣ Testing JWT token generation...');
        const token = await GoogleDrive.getServiceAccountToken();
        if (!token) {
            console.error('❌ Failed to get access token');
            return;
        }
        console.log('✅ Access token received:', token.substring(0, 20) + '...');

        // Test 3: List files in shared folder
        console.log('\n3️⃣ Testing Drive API access...');
        const folderId = GoogleDriveConfig.teamProjectsFolderId;
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            console.error('❌ Drive API request failed:', await response.text());
            return;
        }

        const data = await response.json();
        console.log('✅ Drive API working!');
        console.log('Files in TeamProjects folder:', data.files?.length || 0);

        if (data.files) {
            data.files.forEach(file => {
                console.log(`  - ${file.name} (${file.id})`);
            });
        }

        // Test 4: Test folder creation
        console.log('\n4️⃣ Testing folder creation...');
        const testFolderId = await GoogleDrive.getOrCreateFolder('_test_folder', folderId);
        console.log('✅ Folder created/found:', testFolderId);

        console.log('\n🎉 All tests passed! Service account is working correctly.');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Error details:', error.stack);
    }
}

// Auto-run test when this file is loaded
// Remove this line for production
console.log('To test authentication, run: testServiceAccountAuth()');
