import React, { useEffect } from 'react';

function StatusMessage({ message, onClear }) {
    useEffect(() => {
        // Auto-dismiss after 5 seconds
        const timer = setTimeout(() => {
            onClear();
        }, 5000);

        return () => clearTimeout(timer);
    }, [message, onClear]);

    if (!message) return null;

    return (
        <div className={`status-message ${message.type}`}>
            <span>
                {message.type === 'success' ? '✅' : '❌'} {message.text}
            </span>
            <button onClick={onClear}>&times;</button>
        </div>
    );
}

export default StatusMessage;
