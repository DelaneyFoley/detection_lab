import type { RunQueue, RunQueueControl } from "@/lib/services/interfaces";

class InMemoryRunQueue implements RunQueue {
  private controls = new Map<string, RunQueueControl>();

  create(runId: string): RunQueueControl {
    const control: RunQueueControl = { cancelRequested: false };
    this.controls.set(runId, control);
    return control;
  }

  get(runId: string): RunQueueControl | undefined {
    return this.controls.get(runId);
  }

  requestCancel(runId: string): RunQueueControl {
    const existing = this.controls.get(runId) || { cancelRequested: false };
    existing.cancelRequested = true;
    this.controls.set(runId, existing);
    return existing;
  }

  delete(runId: string): void {
    this.controls.delete(runId);
  }
}

export const runQueue: RunQueue = new InMemoryRunQueue();
