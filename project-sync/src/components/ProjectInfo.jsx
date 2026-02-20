import React from 'react';

function ProjectInfo({ projectData, onRefresh }) {
    if (!projectData) {
        return (
            <div className="project-info">
                <div className="no-project">
                    <p>📁 No project open</p>
                    <p style={{ fontSize: '10px', marginTop: '8px' }}>
                        Open a project in Premiere Pro to sync it
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="project-info">
            <div className="project-info-header">
                <h3>Current Project</h3>
                <button className="refresh-btn" onClick={onRefresh} title="Refresh">
                    🔄
                </button>
            </div>

            <div className="project-name">{projectData.name}</div>

            <div className="project-path" title={projectData.path}>
                {truncatePath(projectData.path, 50)}
            </div>

            <div className="project-stats">
                <div className="stat">
                    <span className="stat-label">Media Files</span>
                    <span className="stat-value">{projectData.mediaCount || 0}</span>
                </div>
                <div className="stat">
                    <span className="stat-label">Size</span>
                    <span className="stat-value">{projectData.mediaSize || 'Unknown'}</span>
                </div>
            </div>
        </div>
    );
}

function truncatePath(path, maxLength) {
    if (!path) return '';
    if (path.length <= maxLength) return path;

    const fileName = path.split(/[/\\]/).pop();
    const remaining = maxLength - fileName.length - 3;

    if (remaining < 10) return '...' + fileName;

    return path.substring(0, remaining) + '...' + fileName;
}

export default ProjectInfo;
