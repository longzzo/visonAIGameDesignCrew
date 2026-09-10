export type BackupStatus = { projects: number; files: number; bytes: number; maxBytes: number };
export type BackupManifest = {
  format: string;
  schemaVersion: number;
  createdAt: string;
  projectCount: number;
  fileCount: number;
  totalBytes: number;
  projects: Array<{ id: string; files: number }>;
};
export type RestoreReceipt = {
  ok: true;
  imported: Array<{ sourceId: string; id: string; copied: boolean }>;
  files: number;
  bytes: number;
  createdAt: string;
};
export function backupStatus(root?: string): BackupStatus;
export function createProjectBackup(options?: { root?: string; projectId?: string; now?: Date }): { buffer: Buffer; manifest: BackupManifest };
export function restoreProjectBackup(buffer: Buffer, options?: { root?: string; now?: Date }): RestoreReceipt;
export function backupApiPlugin(): any;
