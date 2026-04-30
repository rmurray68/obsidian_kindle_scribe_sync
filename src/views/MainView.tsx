import { QueryObserverResult, useQuery } from "@tanstack/react-query";
import { doAmazonLogin, amazonLogoutModal, getNotesData, noAmazonCookies } from "../services/amazonService";
import { NotesList } from "../components/FileView";
import { LoadingComponent } from "../components/LoadingComponent";
import { SyncProgressModal } from "../components/SyncProgressModal";
import { OrphanedNotebooksModal } from "../components/OrphanedNotebooksModal";
import { OrphanEntry } from "../services/syncStateService";
import { LoaderCircle, RefreshCcwDot, Download, Bot } from "lucide-react";
import React, { useEffect, useState } from "react";
import { FileData } from "../types";
import { NoCookiesView } from './NoCookiesView';
import { syncAllDownload, syncAllProcess, syncChangedDownload, syncChangedProcess } from "../hooks/useNotebook";
import { useSettings } from "../context/SettingsContext";
import { Tooltip } from "react-tooltip";

type RefetchFn = () => Promise<QueryObserverResult<FileData[], Error>>;

const NotesError = ({ refetch }: { refetch: RefetchFn }) => {
    return <div className="error-text">
        <p>Failed to fetch notes. </p>
        <p>Probably caused by <b>outdated/non-existing</b> Amazon cookies.<br />
            Try to login with this button:
        </p>
        <button onClick={() => void doAmazonLogin().then(login => { if (login) refetch(); })}>Login to Amazon</button>
        <code style={{ paddingTop: '15px' }}>If that doesn't work - try <b>Logging out and then logging in</b>.</code>
    </div>;
};

const collectNotes = (files: FileData[]): FileData[] => {
    return files.flatMap(item => item.type == 'folder' ? [...collectNotes(item.items), item] : item);
}

interface NotesControlsProps {
    contentLoading: boolean;
    refetch: RefetchFn;
    setIsLoggedOut: () => void;
    data: FileData[];
    onSyncAllPdf: () => void;
    onSyncAllOcr: () => void;
    onSyncChangedPdf: () => void;
    onSyncChangedOcr: () => void;
}

const NotesControls = ({ contentLoading, refetch, setIsLoggedOut, data, onSyncAllPdf, onSyncAllOcr, onSyncChangedPdf, onSyncChangedOcr }: NotesControlsProps) => {
    const { settings } = useSettings();
    const isConfigured = settings.provider === 'github-copilot'
        ? !!settings.githubCopilot.githubAccessToken
        : !!(settings.azure.azureApiKey && settings.azure.azureBaseUrl && settings.azure.azureDeploymentName);
    
    const notes = collectNotes(data);
    const files = notes.filter(item => item.type == 'notebook').length;
    const folders = notes.filter(item => item.type == 'folder').length;
    
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '15px' }}>
        <div style={{ display: 'grid', gap: '15px', justifyContent: 'end', gridAutoFlow: 'column' }}>
            <div>Showing data for {files} notes, {folders} folders in Vault</div>
            <button disabled={contentLoading} onClick={() => {
                void refetch();
            }}>{contentLoading ? <LoaderCircle className="rotate" /> : <RefreshCcwDot />}</button>
            <button onClick={() => {
                void amazonLogoutModal().then(logout => logout && setIsLoggedOut())
            }}>Logout from Amazon</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--background-modifier-border)', paddingTop: '10px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: 500, minWidth: '110px' }}>Sync Changed:</span>
                <button
                    disabled={contentLoading || files === 0}
                    onClick={onSyncChangedPdf}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                    <Download size={16} /> PDF Only
                </button>
                <span>or</span>
                <button
                    disabled={contentLoading || files === 0 || !isConfigured}
                    onClick={onSyncChangedOcr}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    data-tooltip-id="sync-all-tooltip"
                >
                    <Download size={16} /> + <Bot size={16} /> PDF + OCR
                </button>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontWeight: 500, minWidth: '110px', color: 'var(--text-muted)', fontSize: '0.9em' }}>Force All:</span>
                <button
                    disabled={contentLoading || files === 0}
                    onClick={onSyncAllPdf}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8 }}
                >
                    <Download size={16} /> PDF Only
                </button>
                <span>or</span>
                <button
                    disabled={contentLoading || files === 0 || !isConfigured}
                    onClick={onSyncAllOcr}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8 }}
                    data-tooltip-id="sync-all-tooltip"
                >
                    <Download size={16} /> + <Bot size={16} /> PDF + OCR
                </button>
            </div>
            {!isConfigured && <Tooltip id="sync-all-tooltip" place="top">LLM provider not configured. Go to Settings → Kindle Scribe Notes Sync to add your credentials.</Tooltip>}
        </div>
    </div>;
};

export const MainView = () => {
    const [isLoggedOut, setIsLoggedOut] = useState(false);
    const [hasCookies, setHasCookies] = useState<boolean | null>(null);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
    const [orphans, setOrphans] = useState<OrphanEntry[]>([]);
    const { app, settings } = useSettings();

    useEffect(() => {
        void noAmazonCookies().then(missing => setHasCookies(!missing));
    }, []);

    const { data, isLoading, isRefetching, refetch, error } = useQuery({
        queryKey: ['notes', isLoggedOut],
        queryFn: getNotesData,
        enabled: !isLoggedOut,
    });

    const contentLoading = !data || isLoading || isRefetching;

    const handleSyncAllPdf = () => {
        const batchId = syncAllDownload(app, data || [], setOrphans);
        if (batchId) setActiveBatchId(batchId);
    };

    const handleSyncAllOcr = () => {
        const batchId = syncAllProcess(app, data || [], settings, setOrphans);
        if (batchId) setActiveBatchId(batchId);
    };

    const handleSyncChangedPdf = () => {
        const batchId = syncChangedDownload(app, data || [], setOrphans);
        if (batchId) setActiveBatchId(batchId);
    };

    const handleSyncChangedOcr = () => {
        const batchId = syncChangedProcess(app, data || [], settings, setOrphans);
        if (batchId) setActiveBatchId(batchId);
    };

    if (hasCookies === false) {
        return <NoCookiesView setLoggedOut={(value) => { setIsLoggedOut(value); void refetch(); }} />;
    }

    return (
        <div className="file-modal">
            {activeBatchId && (
                <SyncProgressModal 
                    batchId={activeBatchId} 
                    onClose={() => setActiveBatchId(null)} 
                />
            )}
            {!activeBatchId && orphans.length > 0 && (
                <OrphanedNotebooksModal
                    orphans={orphans}
                    app={app}
                    onDone={() => setOrphans([])}
                />
            )}
            {!activeBatchId && orphans.length === 0 && (
                <>
                    <NotesControls
                        data={data || []}
                        contentLoading={contentLoading}
                        setIsLoggedOut={() => setIsLoggedOut(true)}
                        refetch={refetch}
                        onSyncAllPdf={handleSyncAllPdf}
                        onSyncAllOcr={handleSyncAllOcr}
                        onSyncChangedPdf={handleSyncChangedPdf}
                        onSyncChangedOcr={handleSyncChangedOcr}
                    />
                    <div className="notes-content">
                        {error ? <NotesError refetch={refetch} /> : contentLoading ? <LoadingComponent /> : <NotesList objects={data} />}
                    </div>
                </>
            )}
        </div>
    );
};