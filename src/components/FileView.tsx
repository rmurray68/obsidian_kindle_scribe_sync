import React, { useEffect, useState } from "react";
import { FileData } from "../types";
import { useNotebook } from "../hooks/useNotebook";
import { jobManager } from "../utils/jobManager";
import { Bot, Download, GitBranch } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { Tooltip } from "react-tooltip";

const RenderJobProgress = ({ percentage }: { percentage: number }) => {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return (
        <div style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
            {'█'.repeat(filled)}{'░'.repeat(empty)} {percentage}%
        </div>
    );
};


const Note = ({ file, folderPath }: { file: FileData; folderPath: string }) => {
    const [, setTick] = useState(0);
    useEffect(() => {
        const unsub = jobManager.subscribe(() => setTick(t => t + 1));
        return () => { unsub(); };
    }, []);

    const { settings } = useSettings();
    const isConfigured = settings.provider === 'github-copilot'
        ? !!settings.githubCopilot.githubAccessToken
        : !!(settings.azure.azureApiKey && settings.azure.azureBaseUrl && settings.azure.azureDeploymentName);

    const dlJob = jobManager.jobs.get(`${file.id}-dl`);
    const procJob = jobManager.jobs.get(`${file.id}-proc`);
    const diagJob = jobManager.jobs.get(`${file.id}-diag`);
    const activeJob = (dlJob && dlJob.status !== 'completed' && dlJob.status !== 'failed') ? dlJob
        : (procJob && procJob.status !== 'completed' && procJob.status !== 'failed') ? procJob
        : (diagJob && diagJob.status !== 'completed' && diagJob.status !== 'failed') ? diagJob
        : null;
    const { downloadOnly, downloadAndProcess, extractDiagrams } = useNotebook(file.id, file.title, folderPath);

    return (<div className="file-row">
        {file.title}
        {!isConfigured && <Tooltip id="ai-download-tooltip" place="top">Azure OpenAI not configured. Go to Settings → Kindle Scribe Notes Sync to add your credentials.</Tooltip>}
        {activeJob
            ? <RenderJobProgress percentage={activeJob.progress} />
            : <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={downloadOnly}><Download /></button>
                or
                <button disabled={!isConfigured} onClick={downloadAndProcess} data-tooltip-id="ai-download-tooltip"><Download /> + <Bot /></button>
                <button disabled={!isConfigured} onClick={extractDiagrams} data-tooltip-id="ai-download-tooltip" title="Extract diagrams"><GitBranch /></button>
            </div>
        }
    </div>);
}

const BASE_FOLDER = 'Kindle Scribe Notes';

export const NotesList = ({ objects, folderPath = '' }: { objects: FileData[]; folderPath?: string }) => {
    const renderFolder = (folder: FileData) => {
        const childPath = folderPath ? `${folderPath}/${folder.title}` : folder.title;
        return <details key={folder.id} className="file-row" style={{ marginRight: 0}}>
            <summary>{folder.title}</summary>
            <NotesList objects={folder.items} folderPath={childPath} />
        </details>;
    }
    const getOutputPath = (folderPath: string) => folderPath ? `${BASE_FOLDER}/${folderPath}` : BASE_FOLDER;
    return <div>
        {objects.map(file => {
            if (file.type == 'folder')
                return renderFolder(file);
            return <Note key={file.id} file={file} folderPath={getOutputPath(folderPath)} />
        })}
    </div>
};