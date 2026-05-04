import { App, PluginSettingTab, Setting } from "obsidian";
import KindleScribeNotesPlugin from "./index";
import { LlmSettings, LlmProvider } from "./types";
import { runDeviceFlow, clearCopilotTokenCache } from "./services/githubCopilotService";

export type ScribeNotesSettings = LlmSettings;

export const DEFAULT_SETTINGS: LlmSettings = {
    provider: 'azure',
    azure: {
        azureApiKey: '',
        azureBaseUrl: '',
        azureDeploymentName: '',
        azureApiVersion: '2024-02-15-preview',
    },
    githubCopilot: {
        githubAccessToken: '',
        githubCopilotModel: 'gpt-4o',
        githubBaseUrl: 'https://github.com',
    },
};

const GITHUB_COPILOT_MODELS = [
    { value: 'gpt-4.1',            label: 'GPT-4.1' },
    { value: 'gpt-4o',             label: 'GPT-4o' },
    { value: 'gpt-4o-mini',       label: 'GPT-4o Mini' },
    { value: 'o1-mini',           label: 'o1-mini' },
    { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro' },
];

export class ScribeSettingsTab extends PluginSettingTab {
    plugin: KindleScribeNotesPlugin;

    constructor(app: App, plugin: KindleScribeNotesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Provider selector ─────────────────────────────────────────────────
        new Setting(containerEl)
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setName('LLM provider')
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setDesc('Choose which LLM service to use for OCR and analysis.')
            .addDropdown(drop => {
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                drop.addOption('azure', 'Azure OpenAI');
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                drop.addOption('github-copilot', 'GitHub Copilot');
                drop.setValue(this.plugin.settings.provider);
                drop.onChange(async (value) => {
                    this.plugin.settings.provider = value as LlmProvider;
                    await this.plugin.saveSettings();
                    this.display(); // re-render
                });
            });

        // ── Azure section ─────────────────────────────────────────────────────
        if (this.plugin.settings.provider === 'azure') {
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            new Setting(containerEl).setName("Azure OpenAI configuration").setHeading();

            new Setting(containerEl)
                .setName('API key')
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc('Your Azure OpenAI API key')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter API key')
                        .setValue(this.plugin.settings.azure.azureApiKey)
                        .onChange(async (value) => {
                            this.plugin.settings.azure.azureApiKey = value.trim();
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(containerEl)
                .setName('Base URL')
                .setDesc('Azure OpenAI endpoint (e.g. https://your-resource.openai.azure.com)')
                .addText(text => {
                    text.setPlaceholder('https://your-resource.openai.azure.com')
                        .setValue(this.plugin.settings.azure.azureBaseUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.azure.azureBaseUrl = value.trim();
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(containerEl)
                .setName('Deployment name')
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc('The name of your Azure OpenAI deployment')
                .addText(text => {
                    // eslint-disable-next-line obsidianmd/ui/sentence-case
                    text.setPlaceholder('gpt-4o')
                        .setValue(this.plugin.settings.azure.azureDeploymentName)
                        .onChange(async (value) => {
                            this.plugin.settings.azure.azureDeploymentName = value.trim();
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(containerEl)
                .setName('API version')
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc('Azure OpenAI API version')
                .addText(text => {
                    text.setPlaceholder('2024-02-15-preview')
                        .setValue(this.plugin.settings.azure.azureApiVersion)
                        .onChange(async (value) => {
                            this.plugin.settings.azure.azureApiVersion = value.trim();
                            await this.plugin.saveSettings();
                        });
                });
        }

        // ── GitHub Copilot section ─────────────────────────────────────────────
        if (this.plugin.settings.provider === 'github-copilot') {
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            new Setting(containerEl).setName("GitHub Copilot configuration").setHeading();

            containerEl.createEl('p', {
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                text: 'Sign in with your GitHub account to use Copilot for OCR. No OAuth App setup required.',
                cls: 'scribe-setting-info',
            });

            new Setting(containerEl)
                .setName('GitHub base URL')
                .setDesc('Leave as-is for github.com / GitHub Enterprise Cloud. Change for GitHub Enterprise Server.')
                .addText(text => {
                    text.setPlaceholder('https://github.com')
                        .setValue(this.plugin.settings.githubCopilot.githubBaseUrl || 'https://github.com')
                        .onChange(async (value) => {
                            this.plugin.settings.githubCopilot.githubBaseUrl = value.trim();
                            await this.plugin.saveSettings();
                        });
                });

            // Connection status + connect/disconnect
            const isConnected = !!this.plugin.settings.githubCopilot.githubAccessToken;
            const statusText = isConnected
                ? `Connected   (token: …${this.plugin.settings.githubCopilot.githubAccessToken.slice(-6)})`
                : 'Not connected';

            new Setting(containerEl)
                .setName('GitHub account')
                .setDesc(statusText)
                .addButton(btn => {
                    btn.setButtonText(isConnected ? 'Disconnect' : 'Connect with GitHub')
                        .setCta()
                        .onClick(async () => {
                            if (isConnected) {
                                this.plugin.settings.githubCopilot.githubAccessToken = '';
                                clearCopilotTokenCache();
                                await this.plugin.saveSettings();
                                this.display();
                            } else {
                                await runDeviceFlow(this.app, this.plugin.settings.githubCopilot, async (token) => {
                                    this.plugin.settings.githubCopilot.githubAccessToken = token;
                                    await this.plugin.saveSettings();
                                    this.display();
                                });
                            }
                        });
                });

            new Setting(containerEl)
                .setName('Model')
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                .setDesc('Which Copilot model to use for OCR analysis.')
                .addDropdown(drop => {
                    for (const { value, label } of GITHUB_COPILOT_MODELS) {
                        drop.addOption(value, label);
                    }
                    drop.setValue(this.plugin.settings.githubCopilot.githubCopilotModel || 'gpt-4o');
                    drop.onChange(async (value) => {
                        this.plugin.settings.githubCopilot.githubCopilotModel = value;
                        await this.plugin.saveSettings();
                    });
                });
        }
    }
}
