import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { LlmSettings, SettingsProvider } from "../context/SettingsContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../utils/queryClient";
import { MainView } from "../views/MainView";
import '../main.css';

export class ReactWrapper extends Modal {
    root: Root | null = null;
    hidden: boolean = true;
    private settings: LlmSettings;

    constructor(app: App, settings: LlmSettings) {
        super(app);
        this.settings = settings;
    }

    onOpen() {
        const { contentEl } = this;

        this.root = createRoot(contentEl);
        this.setTitle('Kindle notes list');
        this.root.render(
            <React.StrictMode>
                <SettingsProvider settings={this.settings} app={this.app}>
                    <QueryClientProvider client={queryClient}>
                        <MainView />
                    </QueryClientProvider>
                </SettingsProvider>
            </React.StrictMode>
        );
    }

    onClose() {
        this.root = null;
        
        this.contentEl.empty();
    }
}