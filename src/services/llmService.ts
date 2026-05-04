/**
 * LLM Service — unified interface for calling any configured LLM provider.
 *
 * Routes to the appropriate backend (GitHub Copilot or Azure OpenAI)
 * based on the active provider in LlmSettings. All OCR and future LLM
 * features should call this service rather than provider SDKs directly.
 */
import { requestUrl } from 'obsidian';
import { LlmSettings } from '../types';
import { getCopilotSessionToken, clearCopilotTokenCache } from './githubCopilotService';

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface AzureOpenAIResponse {
    choices: Array<{ message: { content: string } }>;
}

/**
 * Send a chat completions request to whichever LLM provider is configured.
 * Returns the text content of the first choice.
 */
export async function callLlm(
    messages: LlmMessage[],
    settings: LlmSettings,
    responseFormat?: object
): Promise<string> {
    if (settings.provider === 'github-copilot') {
        return callCopilot(messages, settings, responseFormat);
    } else {
        return callAzure(messages, settings, responseFormat);
    }
}

// ── GitHub Copilot ────────────────────────────────────────────────────────────

async function callCopilot(
    messages: LlmMessage[],
    settings: LlmSettings,
    responseFormat?: object,
    _retry = false
): Promise<string> {
    const copilotSettings = settings.githubCopilot;
    const copilotToken = await getCopilotSessionToken(copilotSettings);

    let response!: Awaited<ReturnType<typeof requestUrl>>;
    try {
        response = await requestUrl({
            url: 'https://api.githubcopilot.com/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${copilotToken}`,
                'Content-Type': 'application/json',
                'Copilot-Integration-Id': 'vscode-chat',
                'Editor-Version': 'vscode/1.95.0',
            },
            body: JSON.stringify({
                model: copilotSettings.githubCopilotModel || 'gpt-4o',
                messages,
                temperature: 0.3,
                ...(responseFormat ? { response_format: responseFormat } : {}),
            }),
        });
    } catch (err: unknown) {
        // requestUrl throws on non-2xx.
        // 403 — bust the session token cache and wait before retrying.
        //   GitHub Copilot returns 403 for both stale tokens AND rate-limiting.
        //   A 15-second pause gives the rate limit window time to recover.
        // 500 — transient server error, short wait then retry once.
        const status = (err as { status?: number }).status;
        if (status === 403 && !_retry) {
            console.warn('[Copilot] 403 received — clearing token cache and waiting 15s before retry...');
            clearCopilotTokenCache();
            await new Promise(r => setTimeout(r, 15_000));
            return callCopilot(messages, settings, responseFormat, true);
        }
        if (status === 500 && !_retry) {
            await new Promise(r => setTimeout(r, 2000));
            return callCopilot(messages, settings, responseFormat, true);
        }
        throw err;
    }

    const data = response.json as { choices: Array<{ message: { content: string } }> };
    const choice = data.choices[0];
    if (!choice) throw new Error('GitHub Copilot API returned no choices');
    return choice.message.content;
}

// ── Azure OpenAI ──────────────────────────────────────────────────────────────

async function callAzure(
    messages: LlmMessage[],
    settings: LlmSettings,
    responseFormat?: object
): Promise<string> {
    const { azureApiKey, azureBaseUrl, azureDeploymentName, azureApiVersion } = settings.azure;
    const url = `${azureBaseUrl}/openai/deployments/${azureDeploymentName}/chat/completions?api-version=${azureApiVersion}`;

    const response = await requestUrl({
        url,
        method: 'POST',
        headers: { 'api-key': azureApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            temperature: 0.3,
            ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
    });

    const data = response.json as AzureOpenAIResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('Azure OpenAI returned no choices');
    return choice.message.content;
}
