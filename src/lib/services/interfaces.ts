export interface DataStore {
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  run(sql: string, ...params: unknown[]): void;
  transaction<TArgs extends unknown[], TResult>(
    fn: (store: DataStore, ...args: TArgs) => TResult
  ): (...args: TArgs) => TResult;
}

export interface FileStore {
  ensureDatasetUploadDir(datasetId: string): Promise<string>;
  writeDatasetFile(datasetId: string, fileName: string, content: Buffer): Promise<string>;
  removeDatasetUploadDir(datasetId: string): Promise<void>;
  removeLocalUri(uri: string): Promise<void>;
  renameLocalUri(oldUri: string, newUri: string): Promise<string>;
  localUriToAbsPath(uri: string): string | null;
  absPathToLocalUri(absPath: string): string;
}

export interface RunQueueControl {
  cancelRequested: boolean;
}

export interface RunQueue {
  create(runId: string): RunQueueControl;
  get(runId: string): RunQueueControl | undefined;
  requestCancel(runId: string): RunQueueControl;
  delete(runId: string): void;
}
