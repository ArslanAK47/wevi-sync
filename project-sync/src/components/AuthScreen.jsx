import React, { useState } from 'react';
import { authenticateWithGoogle } from '../services/authService';

function AuthScreen({ onSuccess, onError }) {
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [deviceCode, setDeviceCode] = useState(null);

    async function handleConnect() {
        setIsAuthenticating(true);
        setDeviceCode(null);

        try {
            const result = await authenticateWithGoogle((codeData) => {
                // Callback when device code is received
                setDeviceCode(codeData);
            });

            if (result.success) {
                onSuccess();
            } else {
                onError(new Error(result.error || 'Authentication failed'));
            }
        } catch (error) {
            console.error('Auth error:', error);
            onError(error);
        } finally {
            setIsAuthenticating(false);
            setDeviceCode(null);
        }
    }

    return (
        <div className="auth-screen">
            <div className="logo">☁️</div>
            <h2>Connect to Google Drive</h2>
            <p>Sync your projects with your team via Google Drive</p>

            {deviceCode ? (
                <div className="device-code-box">
                    <p>Go to:</p>
                    <p className="verification-url">{deviceCode.verification_url}</p>
                    <p style={{ marginTop: '12px' }}>Enter this code:</p>
                    <p className="device-code">{deviceCode.user_code}</p>
                    <p className="waiting-dots" style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>
                        Waiting for authorization
                    </p>
                </div>
            ) : (
                <button
                    className="btn btn-google btn-full"
                    onClick={handleConnect}
                    disabled={isAuthenticating}
                >
                    {isAuthenticating ? 'Connecting...' : '🔗 Connect Google Drive'}
                </button>
            )}
        </div>
    );
}

export default AuthScreen;
