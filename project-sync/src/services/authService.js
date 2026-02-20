/**
 * Google OAuth Authentication Service
 * Uses Device Flow for desktop app authentication
 */

import { storeToken, getStoredToken } from '../utils/storage';

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = '607746563127-hlt2ffnc3ue12kg4b55e0i9obn7dn896.apps.googleusercontent.com';
const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

/**
 * Authenticate with Google using Device Flow
 * @param {Function} onDeviceCode - Callback when device code is received
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function authenticateWithGoogle(onDeviceCode) {
    try {
        // Step 1: Request device code
        const deviceResponse = await fetch(DEVICE_CODE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                scope: SCOPES
            })
        });

        if (!deviceResponse.ok) {
            throw new Error('Failed to get device code');
        }

        const deviceData = await deviceResponse.json();
        console.log('Device code received:', deviceData.user_code);

        // Step 2: Show code to user
        onDeviceCode({
            user_code: deviceData.user_code,
            verification_url: deviceData.verification_uri || deviceData.verification_url,
            expires_in: deviceData.expires_in
        });

        // Step 3: Poll for token
        const token = await pollForToken(
            deviceData.device_code,
            deviceData.interval || 5
        );

        if (token) {
            storeToken(token);
            return { success: true };
        } else {
            return { success: false, error: 'Authorization timed out' };
        }

    } catch (error) {
        console.error('Auth error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Poll for token after user authorizes
 */
async function pollForToken(deviceCode, interval) {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;
    let pollInterval = interval;

    while (attempts < maxAttempts) {
        await sleep(pollInterval * 1000);
        attempts++;

        try {
            const response = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                })
            });

            const data = await response.json();

            if (data.access_token) {
                console.log('Token received!');
                return data;
            }

            if (data.error === 'authorization_pending') {
                // User hasn't authorized yet, keep polling
                continue;
            }

            if (data.error === 'slow_down') {
                // Increase poll interval
                pollInterval += 5;
                continue;
            }

            if (data.error === 'expired_token') {
                throw new Error('Authorization expired');
            }

            if (data.error === 'access_denied') {
                throw new Error('Access denied by user');
            }

        } catch (error) {
            console.error('Poll error:', error);
            throw error;
        }
    }

    return null; // Timed out
}

/**
 * Refresh an expired token
 */
export async function refreshToken(refreshToken) {
    try {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            })
        });

        if (!response.ok) {
            throw new Error('Token refresh failed');
        }

        const data = await response.json();

        // Preserve refresh token
        const newToken = {
            ...data,
            refresh_token: refreshToken
        };

        storeToken(newToken);
        return newToken;

    } catch (error) {
        console.error('Refresh error:', error);
        return null;
    }
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidToken() {
    const token = getStoredToken();

    if (!token) {
        return null;
    }

    // Check if expired
    const expiresIn = token.expires_in || 3600;
    const storedAt = token.stored_at || Date.now();
    const expiresAt = storedAt + (expiresIn * 1000);

    if (Date.now() > expiresAt - 60000) {
        // Token expired or expiring soon, refresh it
        if (token.refresh_token) {
            const newToken = await refreshToken(token.refresh_token);
            return newToken ? newToken.access_token : null;
        }
        return null;
    }

    return token.access_token;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
