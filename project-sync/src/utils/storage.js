/**
 * Storage Utilities for UXP
 * Handles token persistence using localStorage
 */

const TOKEN_KEY = 'gdrive_auth_token';

/**
 * Store OAuth token
 */
export function storeToken(token) {
    try {
        const tokenData = {
            ...token,
            stored_at: Date.now()
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));
        return true;
    } catch (error) {
        console.error('Error storing token:', error);
        return false;
    }
}

/**
 * Get stored OAuth token
 */
export function getStoredToken() {
    try {
        const data = localStorage.getItem(TOKEN_KEY);
        if (!data) return null;
        return JSON.parse(data);
    } catch (error) {
        console.error('Error getting token:', error);
        return null;
    }
}

/**
 * Clear stored token
 */
export function clearToken() {
    try {
        localStorage.removeItem(TOKEN_KEY);
        return true;
    } catch (error) {
        console.error('Error clearing token:', error);
        return false;
    }
}

/**
 * Check if token is valid (not expired)
 */
export function isTokenValid(token) {
    if (!token || !token.access_token) return false;

    // Check expiration (with 5 minute buffer)
    const expiresIn = token.expires_in || 3600;
    const storedAt = token.stored_at || Date.now();
    const expiresAt = storedAt + (expiresIn * 1000);
    const buffer = 5 * 60 * 1000; // 5 minutes

    return Date.now() < (expiresAt - buffer);
}
