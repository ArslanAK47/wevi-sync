import React, { useState } from 'react';
import { uploadProject } from '../services/googleDrive';

function UploadButton({ projectData, onSuccess, onError }) {
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);

    async function handleUpload() {
        if (!projectData) return;

        setIsUploading(true);
        setProgress(0);

        try {
            const result = await uploadProject(projectData, (percent) => {
                setProgress(percent);
            });

            if (result.success) {
                onSuccess();
            } else {
                onError(new Error(result.error || 'Upload failed'));
            }
        } catch (error) {
            console.error('Upload error:', error);
            onError(error);
        } finally {
            setIsUploading(false);
            setProgress(0);
        }
    }

    return (
        <div>
            <button
                className="btn btn-primary btn-full"
                onClick={handleUpload}
                disabled={!projectData || isUploading}
            >
                {isUploading ? `Uploading... ${progress}%` : '↑ Push to Google Drive'}
            </button>

            {isUploading && (
                <div className="progress-container">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                    <p className="progress-text">Syncing project...</p>
                </div>
            )}
        </div>
    );
}

export default UploadButton;
