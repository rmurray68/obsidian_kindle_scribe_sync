
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

/** Throw this inside a job task to mark it as skipped (no work done, not an error) */
export class SkippedSignal extends Error {
    constructor() { super('SKIPPED'); }
}

type Job = {
    id: string;
    name: string;
    status: JobStatus;
    progress: number;
    batchId?: string;
};

type JobTask = (update: (p: number) => void) => Promise<void>;

type Listener = (jobsArray: Job[]) => void;

class JobManager {
    jobs: Map<string, Job> = new Map();
    private listeners: Set<Listener> = new Set();

    private queue: Array<{ id: string; task: JobTask }> = [];
    private running = 0;
    private concurrency: number;
    private unloaded = false;
    private cancelledBatches: Set<string> = new Set();

    constructor(concurrency = 1) {
        this.concurrency = concurrency;
    }

    // Subscribe to all job state changes. Returns an unsubscribe function.
    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private broadcast() {
        const jobsArray = Array.from(this.jobs.values());
        this.listeners.forEach(listener => listener(jobsArray));
    }

    async addJob(id: string, task: JobTask, name?: string, batchId?: string) {
        if (this.unloaded) return;
        if (batchId && this.cancelledBatches.has(batchId)) return;

        // Overwrite any previous terminal state so the button re-enables after failure.
        const newJob: Job = { id, name: name || id, status: 'queued', progress: 0, batchId };
        this.jobs.set(id, newJob);
        this.broadcast();

        this.queue.push({ id, task });
        this.drain();
    }

    private drain() {
        while (this.running < this.concurrency && this.queue.length > 0 && !this.unloaded) {
            const next = this.queue.shift()!;
            const job = this.jobs.get(next.id);
            
            // Skip if job's batch was cancelled
            if (job?.batchId && this.cancelledBatches.has(job.batchId)) {
                this.updateJob(next.id, { status: 'cancelled' });
                continue;
            }
            
            this.running++;
            void this.runJob(next.id, next.task).finally(() => {
                this.running--;
                this.drain();
            });
        }
    }

    private async runJob(id: string, task: JobTask) {
        const job = this.jobs.get(id);
        if (job?.batchId && this.cancelledBatches.has(job.batchId)) {
            this.updateJob(id, { status: 'cancelled' });
            return;
        }
        
        this.updateJob(id, { status: 'running' });

        try {
            await task((percent) => {
                this.updateJob(id, { progress: Math.round(percent) });
            });
            this.updateJob(id, { status: 'completed', progress: 100 });
        } catch (e) {
            if (e instanceof SkippedSignal) {
                this.updateJob(id, { status: 'skipped', progress: 100 });
            } else {
                console.error(`[JobManager] Job ${id} failed:`, e);
                this.updateJob(id, { status: 'failed' });
            }
        }
    }

    private updateJob(id: string, updates: Partial<Job>) {
        const job = this.jobs.get(id);
        if (job) {
            this.jobs.set(id, { ...job, ...updates });
            this.broadcast();
        }
    }

    /** Cancel all jobs in a batch */
    cancelBatch(batchId: string) {
        this.cancelledBatches.add(batchId);
        
        // Mark queued jobs as cancelled
        for (const [id, job] of this.jobs) {
            if (job.batchId === batchId && job.status === 'queued') {
                this.jobs.set(id, { ...job, status: 'cancelled' });
            }
        }
        
        // Remove from queue
        this.queue = this.queue.filter(item => {
            const job = this.jobs.get(item.id);
            return !job?.batchId || job.batchId !== batchId;
        });
        
        this.broadcast();
    }

    /** Get all jobs for a batch */
    getBatchJobs(batchId: string): Job[] {
        return Array.from(this.jobs.values()).filter(job => job.batchId === batchId);
    }

    /** Check if a batch is complete (all jobs done/failed/cancelled/skipped) */
    isBatchComplete(batchId: string): boolean {
        const jobs = this.getBatchJobs(batchId);
        return jobs.length > 0 && jobs.every(job => 
            job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'skipped'
        );
    }

    /** Call from plugin onunload() to stop accepting new work. In-flight jobs finish naturally. */
    onUnload() {
        this.unloaded = true;
        this.queue = [];
    }
}

export const jobManager = new JobManager(1);
export type { Job, JobStatus };