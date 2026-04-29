/**
 * LLM Service — unified interface for calling any configured LLM provider.
 *
 * Routes to the appropriate backend (GitHub Copilot or Azure OpenAI)
 * based on the active provider in LlmSettings. All OCR and future LLM
 * features should call this service rather than provider SDKs directly.
 */
import { requestUrl } from 'obsidian';
import { LlmSettings } from '../types';
import { getCopilotSessionToken } from './githubCopilotService';

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
    responseFormat?: object
): Promise<string> {
    const copilotSettings = settings.githubCopilot;
    const copilotToken = await getCopilotSessionToken(copilotSettings);

    const response = await requestUrl({
        url: 'https://api.githubcopilot.com/chat/completions',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${copilotToken}`,
            'Content-Type': 'application/json',
            'Copilot-Integration-Id': 'vscode-chat',
            'Editor-Version': 'Obsidian/1.0',
        },
        body: JSON.stringify({
            model: copilotSettings.githubCopilotModel || 'gpt-4o',
            messages,
            temperature: 0.3,
            ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
    });

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
