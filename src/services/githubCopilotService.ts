/**
 * GitHub Copilot service — OAuth device flow authentication only.
 *
 * Handles:
 *  - Device flow: POST /login/device/code → user enters code at github.com/login/device
 *  - Token polling: POST /login/oauth/access_token → OAuth access token (stored in settings)
 *  - Session token: exchange OAuth token → short-lived Copilot session token (cached)
 *
 * LLM calls are routed through llmService.ts, not here.
 */
import { App, Modal, Notice, requestUrl } from 'obsidian';
import { GitHubCopilotSettings } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const shell = (require('electron') as any).remote?.shell ?? (require('electron') as any).shell;

/**
 * Public OAuth application identifier used by the GitHub Copilot VS Code extension.
 * This is NOT a secret — it is intentionally public and the same value used by
 * GitHub’s own tooling (VS Code, JetBrains, Vim plugins) for device-flow auth.
 * See: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

// ── Types ────────────────────────────────────────────────────────────────────

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

interface AccessTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

interface CopilotTokenResponse {
    token: string;
    expires_at: number;
}

// ── Copilot session token cache ──────────────────────────────────────────────

let _cachedCopilotToken: { token: string; expiresAt: number } | null = null;
let _tokenFetchPromise: Promise<string> | null = null;

/** Exchange the stored OAuth access token for a short-lived Copilot session token. Cached until near-expiry. */
export async function getCopilotSessionToken(settings: GitHubCopilotSettings): Promise<string> {
    if (_cachedCopilotToken && _cachedCopilotToken.expiresAt > Date.now() + 60_000) {
        return _cachedCopilotToken.token;
    }

    // Deduplicate concurrent fetches — all callers await the same promise
    if (_tokenFetchPromise) return _tokenFetchPromise;

    _tokenFetchPromise = (async () => {
        try {
            const response = await requestUrl({
                url: 'https://api.github.com/copilot_internal/v2/token',
                headers: {
                    'Authorization': `token ${settings.githubAccessToken}`,
                    'Accept': 'application/json',
                },
            });

            const data = response.json as CopilotTokenResponse;
            if (!data.token) {
                throw new Error('GitHub Copilot session token response missing token field — OAuth token may be expired or revoked.');
            }
            _cachedCopilotToken = { token: data.token, expiresAt: data.expires_at * 1000 };
            return data.token;
        } finally {
            _tokenFetchPromise = null;
        }
    })();

    return _tokenFetchPromise;
}

export function clearCopilotTokenCache() {
    _cachedCopilotToken = null;
    _tokenFetchPromise = null;
}

// ── Device flow ───────────────────────────────────────────────────────────────

/** Show a modal with the user code and poll until the user authorises. Returns the access token or null. */
export async function runDeviceFlow(
    app: App,
    settings: GitHubCopilotSettings,
    onTokenReceived: (token: string) => Promise<void>
): Promise<void> {
    const base = (settings.githubBaseUrl || 'https://github.com').replace(/\/$/, '');

    let deviceData: DeviceCodeResponse;
    try {
        const res = await requestUrl({
            url: `${base}/login/device/code`,
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: 'read:user' }),
        });
        deviceData = res.json as DeviceCodeResponse;
    } catch (e) {
        new Notice('GitHub device flow failed — check your network or GitHub Base URL.');
        console.error('[GitHubCopilot] Device code request failed:', e);
        return;
    }

    const modal = new GitHubDeviceFlowModal(app, deviceData, async () => {
        // User cancelled
    });
    modal.open();

    // Poll for token
    const token = await pollForAccessToken(base, deviceData.device_code, deviceData.interval);
    modal.close();

    if (token) {
        clearCopilotTokenCache();
        await onTokenReceived(token);
        new Notice('GitHub Copilot connected successfully!');
    } else {
        new Notice('GitHub authorisation timed out or was denied.');
    }
}

async function pollForAccessToken(
    base: string,
    deviceCode: string,
    intervalSec: number
): Promise<string | null> {
    const maxAttempts = Math.ceil(300 / intervalSec); // 5 minute max

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, intervalSec * 1000));

        try {
            const res = await requestUrl({
                url: `${base}/login/oauth/access_token`,
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: COPILOT_CLIENT_ID,
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }),
            });

            const data = res.json as AccessTokenResponse;
            if (data.access_token) return data.access_token;
            if (data.error === 'access_denied' || data.error === 'expired_token') return null;
            // 'authorization_pending' or 'slow_down' → keep polling
        } catch {
            // Network blip — keep trying
        }
    }

    return null;
}

// ── Device flow modal ─────────────────────────────────────────────────────────

class GitHubDeviceFlowModal extends Modal {
    private data: DeviceCodeResponse;
    private onCancel: () => void;

    constructor(app: App, data: DeviceCodeResponse, onCancel: () => void) {
        super(app);
        this.data = data;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Connect GitHub Copilot' });
        contentEl.createEl('p', { text: 'Visit the link below and enter your one-time code to authorise.' });

        // Verification URL
        const urlEl = contentEl.createEl('a', {
            text: this.data.verification_uri,
            href: this.data.verification_uri,
        });
        urlEl.style.cssText = 'display:block; margin-bottom:12px; font-size:0.95em;';
        urlEl.addEventListener('click', (e) => {
            e.preventDefault();
            void shell.openExternal(this.data.verification_uri);
        });

        // User code — big and bold
        const codeEl = contentEl.createEl('div', { text: this.data.user_code });
        codeEl.style.cssText = 'font-size:2em; font-weight:bold; letter-spacing:0.15em; margin:12px 0; font-family:monospace;';

        // Buttons row
        const btnRow = contentEl.createEl('div');
        btnRow.style.cssText = 'display:flex; gap:8px; margin-top:16px;';

        const copyBtn = btnRow.createEl('button', { text: 'Copy Code' });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.data.user_code).catch(() => {});
            copyBtn.setText('Copied!');
            setTimeout(() => copyBtn.setText('Copy Code'), 2000);
        });

        const openBtn = btnRow.createEl('button', { text: 'Open in Browser' });
        openBtn.style.cssText = 'flex:1;';
        openBtn.addEventListener('click', () => {
            void shell.openExternal(this.data.verification_uri);
        });

        // Status
        const status = contentEl.createEl('p', { text: 'Waiting for authorisation…' });
        status.style.cssText = 'margin-top:16px; color:var(--text-muted); font-size:0.9em;';
    }

    onClose() {
        this.contentEl.empty();
        this.onCancel();
    }
}
