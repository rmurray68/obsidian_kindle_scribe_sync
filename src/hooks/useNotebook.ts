/**
 * Hook and functions for downloading and processing Kindle Scribe notebooks
 */
import { App, arrayBufferToBase64, Notice } from "obsidian";
import { convertTarToPdf, exportImagesFromTar } from "../utils/pdfExport";
import { processNotebookPages, processNotebookDiagrams } from '../services/ocrService';
import { getAmazonApi, getChunk } from "../services/amazonService";
import { useSettings } from "../context/SettingsContext";
import { useCallback } from "react";
import { jobManager, SkippedSignal } from "../utils/jobManager";
import { sanitizeFileName } from "../utils/fileUtils";
import { LlmSettings, FileData } from "../types";
import { needsSyncCheck, hasModificationChanged, updateNotebookSync, getOrphanedNotebooks, OrphanEntry } from "../services/syncStateService";

type Metadata = {
    metadata: { currentPage: number; modificationTime: number; title: string; totalPages: number };
    readingSessionId: string;
    renderingToken: string;
};

const NOTE_WIDTH = 620;
const NOTE_HEIGHT = 877;
const BASE_FOLDER = 'Kindle Scribe Notes';
const DELTA_CHECK_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type UseNotebook = {
    downloadOnly: () => void;
    downloadAndProcess: () => void;
    extractDiagrams: () => void;
};

/** Fetch notebook metadata from Amazon (modificationTime, totalPages, renderingToken). */
async function getNotebookMetadata(fileId: string): Promise<Metadata> {
    return getAmazonApi<Metadata>(
        `https://read.amazon.com/openNotebook?notebookId=${fileId}&marketplaceId=ATVPDKIKX0DER`
    );
}

/**
 * Fetch notebook metadata, treating a 500 response as a SkippedSignal.
 * Amazon returns 500 for notebooks that have been recently deleted but still appear in the list API.
 */
async function getNotebookMetadataOrSkip(fileId: string): Promise<Metadata> {
    try {
        return await getNotebookMetadata(fileId);
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('500')) throw new SkippedSignal();
        throw e;
    }
}

/** Fetch all pages and save a PDF. Returns the extracted images as base64. */
async function fetchPages(
    app: App,
    fileId: string,
    notebookFolder: string,
    noteName: string,
    update: (p: number) => void,
    prefetchedMeta?: Metadata
): Promise<string[]> {
    update(0);
    const pagesData: ArrayBuffer[] = [];

    const { metadata, renderingToken } = prefetchedMeta ?? await getNotebookMetadata(fileId);
    const notice = new Notice(`Starting fetching pages for ${noteName}`);
    for (let i = 0; i < metadata.totalPages; i += 3) {
        const end = Math.min(i + 2, metadata.totalPages);
        notice.setMessage(`Fetching pages ${i + 1}-${end} out of ${metadata.totalPages}`);

        update((end / metadata.totalPages) * 50);
        const chunk = await getChunk(
            `https://read.amazon.com/renderPage?startPage=${i}&endPage=${end}&width=${NOTE_WIDTH}&height=${NOTE_HEIGHT}&dpi=50`,
            renderingToken
        );
        pagesData.push(chunk);
    }
    notice.hide();
    const images = await exportImagesFromTar(pagesData.map(page => page.slice(0)));
    await convertTarToPdf(app, pagesData, notebookFolder, noteName);
    update(50);

    return images.map(image => arrayBufferToBase64(image.data.buffer as ArrayBuffer));
}

/** Create download task for a single notebook */
export function createDownloadTask(
    app: App,
    fileId: string,
    noteName: string,
    folderPath: string
): (update: (p: number) => void) => Promise<void> {
    const safeName = sanitizeFileName(noteName);
    const notebookFolder = `${folderPath}/${safeName}`;
    
    return async (update: (p: number) => void) => {
        const meta = await getNotebookMetadataOrSkip(fileId);
        await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
        await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'pdf', folderPath, noteName);
        update(100);
        new Notice(`Downloaded "${noteName}" — PDF saved.`);
    };
}

/** Create download + OCR task for a single notebook */
export function createProcessTask(
    app: App,
    fileId: string,
    noteName: string,
    folderPath: string,
    settings: LlmSettings
): (update: (p: number) => void) => Promise<void> {
    const safeName = sanitizeFileName(noteName);
    const notebookFolder = `${folderPath}/${safeName}`;
    
    return async (update: (p: number) => void) => {
        const meta = await getNotebookMetadataOrSkip(fileId);
        const images = await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
        await processNotebookPages(app, images, notebookFolder, safeName, settings);
        await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'ocr', folderPath, noteName);
        update(100);
        new Notice(`Note "${noteName}" downloaded and processed.`);
    };
}

/** Delta variant: local check first, then Amazon metadata check, then sync if needed */
export function createDeltaDownloadTask(
    app: App,
    fileId: string,
    noteName: string,
    folderPath: string
): (update: (p: number) => void) => Promise<void> {
    const safeName = sanitizeFileName(noteName);
    const notebookFolder = `${folderPath}/${safeName}`;

    return async (update: (p: number) => void) => {
        // Step 1: Check local state — is this notebook new or needing upgrade?
        const decision = await needsSyncCheck(app, fileId, 'pdf');

        // Step 2: If previously synced, query Amazon for modificationTime
        if (decision === 'check-remote') {
            await sleep(DELTA_CHECK_DELAY_MS);
            const meta = await getNotebookMetadataOrSkip(fileId);
            const changed = await hasModificationChanged(app, fileId, meta.metadata.modificationTime);
            if (!changed) throw new SkippedSignal();
            // Changed — proceed to download using pre-fetched metadata
            await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
            await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'pdf', folderPath, noteName);
        } else {
            await sleep(DELTA_CHECK_DELAY_MS);
            // New notebook — fetch metadata + download
            const meta = await getNotebookMetadataOrSkip(fileId);
            await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
            await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'pdf', folderPath, noteName);
        }

        update(100);
        new Notice(`Downloaded "${noteName}" — PDF saved.`);
    };
}

/** Delta variant: local check first, then Amazon metadata check, then sync + OCR if needed */
export function createDeltaProcessTask(
    app: App,
    fileId: string,
    noteName: string,
    folderPath: string,
    settings: LlmSettings
): (update: (p: number) => void) => Promise<void> {
    const safeName = sanitizeFileName(noteName);
    const notebookFolder = `${folderPath}/${safeName}`;

    return async (update: (p: number) => void) => {
        // Step 1: Check local state — is this notebook new or needing OCR upgrade?
        const decision = await needsSyncCheck(app, fileId, 'ocr');

        // Step 2: If previously synced with OCR, query Amazon for modificationTime
        if (decision === 'check-remote') {
            await sleep(DELTA_CHECK_DELAY_MS);
            const meta = await getNotebookMetadataOrSkip(fileId);
            const changed = await hasModificationChanged(app, fileId, meta.metadata.modificationTime);
            if (!changed) throw new SkippedSignal();
            // Changed — proceed to download + OCR
            const images = await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
            await processNotebookPages(app, images, notebookFolder, safeName, settings);
            await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'ocr', folderPath, noteName);
        } else {
            await sleep(DELTA_CHECK_DELAY_MS);
            // New or upgrade — fetch metadata + download + OCR
            const meta = await getNotebookMetadataOrSkip(fileId);
            const images = await fetchPages(app, fileId, notebookFolder, safeName, update, meta);
            await processNotebookPages(app, images, notebookFolder, safeName, settings);
            await updateNotebookSync(app, fileId, meta.metadata.modificationTime, 'ocr', folderPath, noteName);
        }

        update(100);
        new Notice(`Note "${noteName}" downloaded and processed.`);
    };
}

/** Collect all notebooks with their folder paths */
function collectNotebooksWithPaths(
    files: FileData[],
    currentPath: string = ''
): Array<{ file: FileData; folderPath: string }> {
    const result: Array<{ file: FileData; folderPath: string }> = [];
    
    for (const file of files) {
        if (file.type === 'folder') {
            const childPath = currentPath ? `${currentPath}/${file.title}` : file.title;
            result.push(...collectNotebooksWithPaths(file.items, childPath));
        } else {
            const outputPath = currentPath ? `${BASE_FOLDER}/${currentPath}` : BASE_FOLDER;
            result.push({ file, folderPath: outputPath });
        }
    }
    
    return result;
}

/** Sync all notebooks - PDF only. Returns batchId for tracking. */
export function syncAllDownload(app: App, data: FileData[], onOrphansFound?: (orphans: OrphanEntry[]) => void): string | null {
    const notebooks = collectNotebooksWithPaths(data);
    if (notebooks.length === 0) {
        new Notice('No notebooks to sync');
        return null;
    }
    
    const batchId = `batch-dl-${Date.now()}`;
    
    for (const { file, folderPath } of notebooks) {
        const task = createDownloadTask(app, file.id, file.title, folderPath);
        void jobManager.addJob(`${file.id}-dl`, task, file.title, batchId);
    }

    if (onOrphansFound) {
        const liveIds = new Set(notebooks.map(n => n.file.id));
        void jobManager.addJob(`orphan-check-${batchId}`, async (update) => {
            const orphans = await getOrphanedNotebooks(app, liveIds);
            if (orphans.length > 0) onOrphansFound(orphans);
            update(100);
        }, 'Checking for removed notebooks', batchId);
    }
    
    return batchId;
}

/** Sync all notebooks - PDF + OCR. Returns batchId for tracking. */
export function syncAllProcess(app: App, data: FileData[], settings: LlmSettings, onOrphansFound?: (orphans: OrphanEntry[]) => void): string | null {
    const notebooks = collectNotebooksWithPaths(data);
    if (notebooks.length === 0) {
        new Notice('No notebooks to sync');
        return null;
    }
    
    const batchId = `batch-proc-${Date.now()}`;
    
    for (const { file, folderPath } of notebooks) {
        const task = createProcessTask(app, file.id, file.title, folderPath, settings);
        void jobManager.addJob(`${file.id}-proc`, task, file.title, batchId);
    }

    if (onOrphansFound) {
        const liveIds = new Set(notebooks.map(n => n.file.id));
        void jobManager.addJob(`orphan-check-${batchId}`, async (update) => {
            const orphans = await getOrphanedNotebooks(app, liveIds);
            if (orphans.length > 0) onOrphansFound(orphans);
            update(100);
        }, 'Checking for removed notebooks', batchId);
    }
    
    return batchId;
}

/** Delta sync — PDF only, skips notebooks unchanged since last sync. */
export function syncChangedDownload(app: App, data: FileData[], onOrphansFound?: (orphans: OrphanEntry[]) => void): string | null {
    const notebooks = collectNotebooksWithPaths(data);
    if (notebooks.length === 0) {
        new Notice('No notebooks to sync');
        return null;
    }

    const batchId = `batch-delta-dl-${Date.now()}`;

    for (const { file, folderPath } of notebooks) {
        const task = createDeltaDownloadTask(app, file.id, file.title, folderPath);
        void jobManager.addJob(`${file.id}-dl`, task, file.title, batchId);
    }

    // Final job: detect orphaned notebooks
    const liveIds = new Set(notebooks.map(n => n.file.id));
    void jobManager.addJob(`orphan-check-${batchId}`, async (update) => {
        const orphans = await getOrphanedNotebooks(app, liveIds);
        if (orphans.length > 0) {
            if (onOrphansFound) onOrphansFound(orphans);
            else new Notice(`${orphans.length} notebook(s) no longer on Kindle.`);
        }
        update(100);
    }, 'Checking for removed notebooks', batchId);

    return batchId;
}

/** Delta sync — PDF + OCR, skips notebooks unchanged since last sync. */
export function syncChangedProcess(app: App, data: FileData[], settings: LlmSettings, onOrphansFound?: (orphans: OrphanEntry[]) => void): string | null {
    const notebooks = collectNotebooksWithPaths(data);
    if (notebooks.length === 0) {
        new Notice('No notebooks to sync');
        return null;
    }

    const batchId = `batch-delta-proc-${Date.now()}`;

    for (const { file, folderPath } of notebooks) {
        const task = createDeltaProcessTask(app, file.id, file.title, folderPath, settings);
        void jobManager.addJob(`${file.id}-proc`, task, file.title, batchId);
    }

    // Final job: detect orphaned notebooks
    const liveIds = new Set(notebooks.map(n => n.file.id));
    void jobManager.addJob(`orphan-check-${batchId}`, async (update) => {
        const orphans = await getOrphanedNotebooks(app, liveIds);
        if (orphans.length > 0) {
            if (onOrphansFound) onOrphansFound(orphans);
            else new Notice(`${orphans.length} notebook(s) no longer on Kindle.`);
        }
        update(100);
    }, 'Checking for removed notebooks', batchId);

    return batchId;
}

export const useNotebook = (fileId: string, noteName: string, folderPath: string): UseNotebook => {
    const { app, settings } = useSettings();
    const safeName = sanitizeFileName(noteName);
    // Create notebook-specific subfolder under the folder path
    const notebookFolder = `${folderPath}/${safeName}`;

    const downloadOnlyTask = useCallback(async (update: (p: number) => void) => {
        await fetchPages(app, fileId, notebookFolder, safeName, update);
        update(100);
        new Notice(`Downloaded "${noteName}" — PDF saved.`);
    }, [app, fileId, notebookFolder, safeName, noteName]);

    const downloadAndProcessTask = useCallback(async (update: (p: number) => void) => {
        const images = await fetchPages(app, fileId, notebookFolder, safeName, update);
        await processNotebookPages(
            app,
            images,
            notebookFolder,
            safeName,
            settings
        );
        update(100);
        new Notice(`Note "${noteName}" downloaded and processed.`);
    }, [app, fileId, notebookFolder, safeName, noteName, settings]);

    const extractDiagramsTask = useCallback(async (update: (p: number) => void) => {
        const images = await fetchPages(app, fileId, notebookFolder, safeName, update);
        await processNotebookDiagrams(app, images, notebookFolder, safeName, settings);
        update(100);
    }, [app, fileId, notebookFolder, safeName, settings]);

    return {
        downloadOnly: () => void jobManager.addJob(`${fileId}-dl`, downloadOnlyTask, noteName),
        downloadAndProcess: () => void jobManager.addJob(`${fileId}-proc`, downloadAndProcessTask, noteName),
        extractDiagrams: () => void jobManager.addJob(`${fileId}-diag`, extractDiagramsTask, noteName),
    };
};
