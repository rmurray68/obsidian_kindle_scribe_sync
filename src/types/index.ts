/**
 * Consolidated type definitions for the Kindle Scribe Notes Sync plugin
 */

export type LlmProvider = 'azure' | 'github-copilot';

/** Azure OpenAI configuration settings */
export interface AzureSettings {
    azureApiKey: string;
    azureBaseUrl: string;
    azureDeploymentName: string;
    azureApiVersion: string;
}

/** GitHub Copilot configuration settings */
export interface GitHubCopilotSettings {
    /** Stored OAuth access token (obtained via device flow) */
    githubAccessToken: string;
    /** Model to use, e.g. 'gpt-4o', 'claude-3.5-sonnet' */
    githubCopilotModel: string;
    /** GitHub base URL — defaults to https://github.com, override for GHE Server */
    githubBaseUrl: string;
}

/** Unified LLM settings passed to OCR service and settings tab */
export interface LlmSettings {
    provider: LlmProvider;
    azure: AzureSettings;
    githubCopilot: GitHubCopilotSettings;
}

/** Kindle notebook/folder data structure from Amazon API */
export interface FileData {
    id: string;
    title: string;
    type: 'notebook' | 'folder';
    items: FileData[];
}

/** OCR analysis result from Azure OpenAI */
export interface NotebookAnalysis {
    text: string;
    crops: Array<{ id: string; box_2d: [number, number, number, number] }>;
}
