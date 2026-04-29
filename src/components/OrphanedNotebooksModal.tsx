import React, { useState } from "react";
import { App, Notice } from "obsidian";
import { OrphanEntry, removeOrphanedNotebook } from "../services/syncStateService";
import { Trash2, FolderOpen } from "lucide-react";

interface OrphanedNotebooksModalProps {
    orphans: OrphanEntry[];
    app: App;
    onDone: () => void;
}

export const OrphanedNotebooksModal = ({ orphans, app, onDone }: OrphanedNotebooksModalProps) => {
    const [checked, setChecked] = useState<Set<string>>(new Set(orphans.map(o => o.id)));
    const [deleting, setDeleting] = useState(false);

    const toggleCheck = (id: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleDeleteSelected = async () => {
        setDeleting(true);
        const toDelete = orphans.filter(o => checked.has(o.id));
        let deleted = 0;
        for (const orphan of toDelete) {
            try {
                await removeOrphanedNotebook(app, orphan.id);
                deleted++;
            } catch (e) {
                new Notice(`Failed to delete "${orphan.title}"`);
            }
        }
        if (deleted > 0) new Notice(`Deleted ${deleted} notebook${deleted > 1 ? 's' : ''}.`);
        onDone();
    };

    const handleKeepAll = () => {
        onDone();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                backgroundColor: 'var(--background-secondary)',
                borderRadius: '8px',
            }}>
                <div style={{ fontWeight: 600, fontSize: '1.1em', marginBottom: '4px' }}>
                    {orphans.length} Notebook{orphans.length > 1 ? 's' : ''} Removed from Kindle
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
                    These notebooks no longer appear on your Kindle. Select which to delete from your vault.
                </div>
            </div>

            {/* Notebook list */}
            <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
            }}>
                {orphans.map(orphan => (
                    <label
                        key={orphan.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--background-modifier-border)',
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={checked.has(orphan.id)}
                            onChange={() => toggleCheck(orphan.id)}
                            style={{ cursor: 'pointer' }}
                        />
                        <FolderOpen size={16} color="var(--text-muted)" />
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {orphan.title}
                            </div>
                            <div style={{ fontSize: '0.8em', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {orphan.notebookFolder}
                            </div>
                        </div>
                    </label>
                ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={handleKeepAll} disabled={deleting}>
                    Keep All
                </button>
                <button
                    onClick={() => void handleDeleteSelected()}
                    disabled={deleting || checked.size === 0}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: checked.size > 0 ? 'var(--background-modifier-error)' : undefined,
                        color: checked.size > 0 ? 'var(--text-on-accent)' : undefined,
                    }}
                >
                    <Trash2 size={14} />
                    Delete Selected ({checked.size})
                </button>
            </div>
        </div>
    );
};
