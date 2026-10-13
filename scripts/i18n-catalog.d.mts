export type CatalogLocale = "en" | "zh-CN";

export interface CatalogEntry {
  en: string;
  "zh-CN": string;
  reviewedEnglishHash: string | null;
}

export interface Catalog {
  entries: Map<string, CatalogEntry>;
  dictionaries: Record<CatalogLocale, Record<string, string>>;
  keyFiles: Map<string, string>;
  keyCount: number;
  sourceFileCount: number;
  fileEntries: Map<string, string[]>;
}

export function englishHash(en: string): string;
export function sourceRelativePathForKey(key: string): string;
export function readCatalog(options: { root: string; requireReviewed?: boolean }): Promise<Catalog>;
export function checkCatalog(options: { root: string; artifactRoot?: string }): Promise<Catalog>;
export function buildCatalog(options: { root: string }): Promise<Catalog>;
export function reviewKeys(options: { root: string; keys: string[] }): Promise<Catalog>;
