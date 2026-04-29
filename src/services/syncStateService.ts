/**
 * Sync state service — persists per-notebook sync metadata to the vault.
 * Stored at: Kindle Scribe Notes/.sync-state.json
 */
import { App, normalizePath } from "obsidian";

export type SyncMode = 'pdf' | 'ocr';

interface NotebookSyncEntry {
    modificationTime: number;
    syncedAt: number;
    mode: SyncMode;
    folderPath: string;
    title: string;
}

interface SyncState {
    notebooks: Record<string, NotebookSyncEntry>;
}

const SYNC_STATE_PATH = normalizePath('Kindle Scribe Notes/.sync-state.json');
const SYNC_STATE_DIR  = normalizePath('Kindle Scribe Notes');

async function loadSyncState(app: App): Promise<SyncState> {
    try {
        if (await app.vault.adapter.exists(SYNC_STATE_PATH)) {
            const raw = await app.vault.adapter.read(SYNC_STATE_PATH);
            return JSON.parse(raw) as SyncState;
        }
    } catch {
        // Corrupt or missing — start fresh
    }
    return { notebooks: {} };
}

async function saveSyncState(app: App, state: SyncState): Promise<void> {
    if (!(await app.vault.adapter.exists(SYNC_STATE_DIR))) {
        await app.vault.createFolder(SYNC_STATE_DIR);
    }
    await app.vault.adapter.write(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

export async function updateNotebookSync(
    app: App,
    id: string,
    modificationTime: number,
    mode: SyncMode,
    folderPath: string,
    title: string
): Promise<void> {
    const state = await loadSyncState(app);
    state.notebooks[id] = { modificationTime, syncedAt: Date.now(), mode, folderPath, title };
    await saveSyncState(app, state);
}

/**
 * Returns true if the notebook needs to be (re-)synced.
 * Checks LOCAL state only — no network calls.
 * - Never synced before → needs sync
 * - Requesting OCR but only PDF was previously synced → needs sync (upgrade)
 * - Otherwise → needs Amazon timestamp check
 */
export async function needsSyncCheck(
    app: App,
    id: string,
    requestedMode: SyncMode
): Promise<'sync' | 'check-remote'> {
    const state = await loadSyncState(app);
    const entry = state.notebooks[id];
    if (!entry) return 'sync';
    if (requestedMode === 'ocr' && entry.mode === 'pdf') return 'sync';
    return 'check-remote';
}

/**
 * Returns true if the notebook's modificationTime has changed since last sync.
 * Called AFTER we've already fetched metadata from Amazon.
 */
export async function hasModificationChanged(
    app: App,
    id: string,
    currentModificationTime: number
): Promise<boolean> {
    const state = await loadSyncState(app);
    const entry = state.notebooks[id];
    if (!entry) return true;
    return currentModificationTime > entry.modificationTime;
}

/** Wipe all stored sync state (for manual full-reset). */
export async function clearSyncState(app: App): Promise<void> {
    await saveSyncState(app, { notebooks: {} });
}

export interface OrphanEntry {
    id: string;
    title: string;
    folderPath: string;
    safeName: string;
    notebookFolder: string;
}

/**
 * Returns list of notebooks in sync state that no longer exist on the Kindle
 * AND whose folder still exists in the vault.
 */
export async function getOrphanedNotebooks(
    app: App,
    liveNotebookIds: Set<string>
): Promise<OrphanEntry[]> {
    const state = await loadSyncState(app);
    const orphans: OrphanEntry[] = [];

    for (const [id, entry] of Object.entries(state.notebooks)) {
        if (liveNotebookIds.has(id)) continue;
        if (!entry.folderPath || !entry.title) continue;

        const safeName = entry.title.replace(/[\\/:*?"<>|]/g, '_');
        const notebookFolder = normalizePath(`${entry.folderPath}/${safeName}`);

        if (await app.vault.adapter.exists(notebookFolder)) {
            orphans.push({ id, title: entry.title, folderPath: entry.folderPath, safeName, notebookFolder });
        }
    }

    return orphans;
}

/**
 * Delete an orphaned notebook's folder from the vault and remove it from sync state.
 */
export async function removeOrphanedNotebook(app: App, id: string): Promise<void> {
    const state = await loadSyncState(app);
    const entry = state.notebooks[id];
    if (!entry) return;

    const safeName = entry.title.replace(/[\\/:*?"<>|]/g, '_');
    const notebookFolder = normalizePath(`${entry.folderPath}/${safeName}`);

    if (await app.vault.adapter.exists(notebookFolder)) {
        await app.vault.adapter.rmdir(notebookFolder, true);
    }

    delete state.notebooks[id];
    await saveSyncState(app, state);
}

/**
 * @deprecated Use getOrphanedNotebooks() instead.
 * Kept for backward compatibility.
 */
export async function detectOrphanedNotebooks(
    app: App,
    liveNotebookIds: Set<string>
): Promise<number> {
    const orphans = await getOrphanedNotebooks(app, liveNotebookIds);
    return orphans.length;
}
