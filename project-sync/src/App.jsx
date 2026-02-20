import React, { useState, useEffect } from 'react';
import AuthScreen from './components/AuthScreen';
import ProjectInfo from './components/ProjectInfo';
import UploadButton from './components/UploadButton';
import StatusMessage from './components/StatusMessage';
import { getStoredToken, isTokenValid } from './utils/storage';
import { getProjectData } from './services/premiereAPI';

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [projectData, setProjectData] = useState(null);
    const [statusMessage, setStatusMessage] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check authentication and load project on mount
    useEffect(() => {
        initializeApp();
    }, []);

    async function initializeApp() {
        try {
            // Check stored token
            const token = getStoredToken();
            if (token && isTokenValid(token)) {
                setIsAuthenticated(true);
            }

            // Try to get current project data
            const project = await getProjectData();
            setProjectData(project);
        } catch (error) {
            console.error('Init error:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function handleAuthSuccess() {
        setIsAuthenticated(true);
        setStatusMessage({ type: 'success', text: 'Connected to Google Drive!' });
    }

    function handleAuthError(error) {
        setStatusMessage({ type: 'error', text: error.message || 'Authentication failed' });
    }

    function handleUploadSuccess() {
        setStatusMessage({ type: 'success', text: 'Project synced successfully!' });
    }

    function handleUploadError(error) {
        setStatusMessage({ type: 'error', text: error.message || 'Upload failed' });
    }

    async function handleRefresh() {
        try {
            const project = await getProjectData();
            setProjectData(project);
            setStatusMessage({ type: 'success', text: 'Project data refreshed' });
        } catch (error) {
            setStatusMessage({ type: 'error', text: 'Could not refresh project data' });
        }
    }

    function clearStatus() {
        setStatusMessage(null);
    }

    if (isLoading) {
        return (
            <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    return (
        <div className="app">
            <header className="app-header">
                <h1>🎬 Project Sync</h1>
            </header>

            {statusMessage && (
                <StatusMessage
                    message={statusMessage}
                    onClear={clearStatus}
                />
            )}

            {!isAuthenticated ? (
                <AuthScreen
                    onSuccess={handleAuthSuccess}
                    onError={handleAuthError}
                />
            ) : (
                <main className="app-main">
                    <ProjectInfo
                        projectData={projectData}
                        onRefresh={handleRefresh}
                    />

                    <div className="action-buttons">
                        <UploadButton
                            projectData={projectData}
                            onSuccess={handleUploadSuccess}
                            onError={handleUploadError}
                        />
                    </div>
                </main>
            )}
        </div>
    );
}

export default App;
