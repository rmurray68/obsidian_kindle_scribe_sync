import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ScribeNotesSettings, ScribeSettingsTab } from "./settings";
import { ReactWrapper } from './components/ReactWrapper';
import { jobManager } from './utils/jobManager';

export default class KindleScribeNotesPlugin extends Plugin {
    settings: ScribeNotesSettings;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('notebook-pen', 'Scribe notes convert', async () => {
            new ReactWrapper(this.app, this.settings).open();
        });

        this.addSettingTab(new ScribeSettingsTab(this.app, this));

        // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
        // Using this function will automatically remove the event listener when this plugin is disabled.
        // this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
        // 	new Notice("Click");
        // });

    }

    onunload() {
        jobManager.onUnload();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ScribeNotesSettings>);

    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}