// notion-publish.mjs 타입 선언 — vite.config.ts(tsc)용

export interface NotionCfg {
  token: string;
  parentPageId: string;
  auto: boolean;
}

export interface NotionReport {
  ts: number;
  title: string;
  markdown: string;
}

export interface NotionPublishPayload {
  projectId: string;
  projectName: string;
  gddMd: string;
  reports: NotionReport[];
}

export declare function loadCfg(): NotionCfg;
export declare function saveCfg(cfg: NotionCfg): void;
export declare function parsePageId(input: string): string;
export declare function verifySetup(token: string, parentPageId: string): Promise<{ user: string; pageTitle: string }>;
export declare function mdToBlocks(md: string): unknown[];
export declare function splitSections(md: string): { num: number; title: string; body: string; icon: string }[];
export declare function publishProject(payload: NotionPublishPayload): Promise<{ ok: boolean; pageId: string; url: string }>;
export declare function queueAutoPublish(projectId: string, getPayload: () => Promise<NotionPublishPayload>): void;
export declare function lastPublishInfo(projectId: string): { url: string; ts: number } | null;

export interface NotionPageRead {
  pageId: string;
  title: string;
  md: string;
  blockCount: number;
  complexCount: number;
  notes: string[];
  url: string;
}
export declare function fetchPageAsMd(pageUrlOrId: string): Promise<NotionPageRead>;
export declare function updatePageContent(
  pageUrlOrId: string,
  markdown: string,
  mode?: "replace" | "append"
): Promise<{ ok: boolean; pageId: string; url: string; preserved: number; backup: string }>;
