import { App } from 'obsidian';
import React, { createContext, useContext } from 'react';
import { LlmSettings } from '../types';

export type { LlmSettings } from '../types';

interface SettingsContextType {
    settings: LlmSettings;
    app: App;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode, settings: LlmSettings, app: App }> = ({ children, settings, app }) => {
    return (
        <SettingsContext.Provider value={{ settings, app }}>
            {children}
        </SettingsContext.Provider>
    );
};

// Custom hook for easy access
export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};