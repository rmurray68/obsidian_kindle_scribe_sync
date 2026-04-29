import React, { useEffect, useState } from "react";
import { jobManager, Job } from "../utils/jobManager";
import { CheckCircle, XCircle, Loader, Clock, Ban, MinusCircle } from "lucide-react";

interface SyncProgressModalProps {
    batchId: string;
    onClose: () => void;
}

const StatusIcon = ({ status }: { status: Job['status'] }) => {
    switch (status) {
        case 'completed':
            return <CheckCircle size={16} color="var(--text-success)" />;
        case 'failed':
            return <XCircle size={16} color="var(--text-error)" />;
        case 'running':
            return <Loader size={16} className="rotate" />;
        case 'cancelled':
            return <Ban size={16} color="var(--text-muted)" />;
        case 'skipped':
            return <MinusCircle size={16} color="var(--text-muted)" />;
        default:
            return <Clock size={16} color="var(--text-muted)" />;
    }
};

const ProgressBar = ({ progress }: { progress: number }) => {
    return (
        <div style={{ 
            width: '60px', 
            height: '6px', 
            backgroundColor: 'var(--background-modifier-border)',
            borderRadius: '3px',
            overflow: 'hidden'
        }}>
            <div style={{ 
                width: `${progress}%`, 
                height: '100%', 
                backgroundColor: 'var(--interactive-accent)',
                transition: 'width 0.2s ease'
            }} />
        </div>
    );
};

export const SyncProgressModal = ({ batchId, onClose }: SyncProgressModalProps) => {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [cancelled, setCancelled] = useState(false);

    useEffect(() => {
        const updateJobs = () => {
            setJobs(jobManager.getBatchJobs(batchId));
        };
        
        updateJobs();
        const unsub = jobManager.subscribe(updateJobs);
        return () => { unsub(); };
    }, [batchId]);

    const completed = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const cancelledCount = jobs.filter(j => j.status === 'cancelled').length;
    const skipped = jobs.filter(j => j.status === 'skipped').length;
    const total = jobs.length;
    const isComplete = jobManager.isBatchComplete(batchId);
    const running = jobs.find(j => j.status === 'running');

    const handleCancel = () => {
        jobManager.cancelBatch(batchId);
        setCancelled(true);
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '8px 0'
        }}>
            {/* Overall Progress */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '12px 16px',
                backgroundColor: 'var(--background-secondary)',
                borderRadius: '8px'
            }}>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '1.1em' }}>
                        {isComplete ? 'Sync Complete' : 'Syncing Notebooks...'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
                        {completed}/{total - skipped - cancelledCount} synced
                        {skipped > 0 && <span style={{ color: 'var(--text-muted)' }}> • {skipped} unchanged</span>}
                        {failed > 0 && <span style={{ color: 'var(--text-error)' }}> • {failed} failed</span>}
                        {cancelledCount > 0 && <span style={{ color: 'var(--text-muted)' }}> • {cancelledCount} cancelled</span>}
                    </div>
                </div>
                <div style={{ 
                    width: '120px', 
                    height: '8px', 
                    backgroundColor: 'var(--background-modifier-border)',
                    borderRadius: '4px',
                    overflow: 'hidden'
                }}>
                    <div style={{ 
                        width: `${total > 0 ? ((completed + failed + cancelledCount + skipped) / total) * 100 : 0}%`, 
                        height: '100%', 
                        backgroundColor: failed > 0 ? 'var(--text-warning)' : 'var(--interactive-accent)',
                        transition: 'width 0.3s ease'
                    }} />
                </div>
            </div>

            {/* Current Job */}
            {running && (
                <div style={{ 
                    padding: '8px 16px',
                    backgroundColor: 'var(--background-primary-alt)',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <Loader size={18} className="rotate" />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{running.name}</div>
                        <ProgressBar progress={running.progress} />
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{running.progress}%</span>
                </div>
            )}

            {/* Job List */}
            <div style={{ 
                maxHeight: '300px', 
                overflowY: 'auto',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px'
            }}>
                {jobs.map(job => (
                    <div 
                        key={job.id} 
                        style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px',
                            padding: '8px 12px',
                            borderBottom: '1px solid var(--background-modifier-border)',
                            opacity: (job.status === 'cancelled' || job.status === 'skipped') ? 0.5 : 1
                        }}
                    >
                        <StatusIcon status={job.status} />
                        <span style={{ 
                            flex: 1, 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap' 
                        }}>
                            {job.name}
                        </span>
                        {job.status === 'running' && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{job.progress}%</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                {!isComplete && !cancelled && (
                    <button 
                        onClick={handleCancel}
                        style={{ backgroundColor: 'var(--background-modifier-error)' }}
                    >
                        Cancel Sync
                    </button>
                )}
                <button 
                    onClick={onClose}
                    className={isComplete ? 'mod-cta' : ''}
                >
                    {isComplete ? 'Done' : 'Run in Background'}
                </button>
            </div>
        </div>
    );
};
