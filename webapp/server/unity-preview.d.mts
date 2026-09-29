export interface UnityPreviewStatus {
  ready: boolean;
  projectDir: string | null;
  projectExists: boolean;
  buildDir: string | null;
  configuredBuild: string | null;
  updatedAt: number;
  reason: string;
  previewUrl: string | null;
}
export function getUnityPreviewStatus(): UnityPreviewStatus;
export function setUnityWebglDir(dir: string): UnityPreviewStatus;
export function resolveUnityPreviewFile(requestPath: string): string;
