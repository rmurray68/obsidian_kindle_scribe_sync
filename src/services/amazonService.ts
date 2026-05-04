/**
 * Amazon service - handles all Amazon Kindle API interactions and authentication
 */

interface ElectronCookie { name: string; value: string; }
interface ElectronBrowserWindow {
    once(event: string, listener: () => void): void;
    setTitle(title: string): void;
    show(): void;
    close(): void;
    webContents: { on(event: string, listener: (event: unknown, url: string) => void): void; };
    on(event: string, listener: () => void): void;
    loadURL(url: string): Promise<void>;
}
interface ElectronRemote {
    BrowserWindow: new (options: object) => ElectronBrowserWindow;
    session: { defaultSession: { cookies: { get(filter: { domain: string }): Promise<ElectronCookie[]>; }; }; };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
const remote = (require('electron') as { remote: ElectronRemote }).remote;
import { requestUrl } from "obsidian";
import { FileData } from '../types';

const RemoteBrowserWindow = remote.BrowserWindow;

// ============================================================================
// Cookie Management
// ============================================================================

export const getAmazonCookies = async (): Promise<string> => {
    const ses = remote.session.defaultSession;
    const cookies = await ses.cookies.get({ domain: '.amazon.com' });
    return cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
};

export const noAmazonCookies = async (): Promise<boolean> => {
    const ses = remote.session.defaultSession;
    const cookies = await ses.cookies.get({ domain: '.amazon.com' });
    return cookies.length === 0;
};

// ============================================================================
// API Requests (with retry + exponential backoff for rate-limiting)
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;

async function requestWithRetry(options: { url: string; headers: Record<string, string> }) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await requestUrl(options);
        } catch (e: unknown) {
            lastError = e;
            const msg = e instanceof Error ? e.message : String(e);
            const isRateLimited = msg.includes('400') || msg.includes('429');
            if (!isRateLimited || attempt === MAX_RETRIES) throw e;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            console.debug(`[Amazon] Request failed (${msg}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
        }
    }
    throw lastError;
}

export const getAmazonApi = async <T extends object>(endpointUrl: string, headers?: object): Promise<T> => {
    const result = await requestWithRetry({
        url: endpointUrl,
        headers: {
            Cookie: await getAmazonCookies(),
            ...headers
        }
    });
    return result.json as T;
};

export const getChunk = async (endpointUrl: string, renderingToken: string): Promise<ArrayBuffer> => {
    const result = await requestWithRetry({
        url: endpointUrl,
        headers: {
            Cookie: await getAmazonCookies(),
            "x-amzn-karamel-notebook-rendering-token": renderingToken
        }
    });
    return result.arrayBuffer;
};

export const getNotesData = async (): Promise<FileData[]> => {
    const result = await getAmazonApi<{ itemsList: FileData[] }>('https://read.amazon.com/kindle-notebook/api/notes');
    return result.itemsList;
};

// ============================================================================
// Authentication Modals
// ============================================================================

const createAuthWindow = () => {
    return new RemoteBrowserWindow({
        width: 450,
        height: 730,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
};

export const doAmazonLogin = async (): Promise<boolean> => {
    const modal = createAuthWindow();

    modal.once('ready-to-show', () => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        modal.setTitle('Connect your Amazon account to Obsidian');
        modal.show();
    });

    return new Promise((resolve) => {
        try {
            modal.webContents.on('did-navigate', (_event: unknown, url: string) => {
                if (url.startsWith('https://read.amazon.com')) {
                    modal.close();
                    resolve(true);
                }
            });
            modal.on('closed', () => {
                resolve(false);
            });
            void modal.loadURL('https://read.amazon.com/notebook');
        } catch {
            // Swallow error - loadUrl is interrupted on successful login
        }
    });
};

export const amazonLogoutModal = (): Promise<boolean> => {
    const modal = createAuthWindow();

    modal.once('ready-to-show', () => {
        modal.setTitle('Logging out');
        modal.show();
    });

    return new Promise((resolve) => {
        try {
            modal.webContents.on('did-navigate', (_event: unknown, url: string) => {
                if (url.startsWith('https://www.amazon.com/ap/signin')) {
                    modal.close();
                    resolve(true);
                }
            });
            modal.on('closed', () => {
                resolve(false);
            });
            void modal.loadURL('https://www.amazon.com/gp/flex/sign-out.html');
        } catch {
            // Swallow error - loadUrl is interrupted on successful logout
        }
    });
};
