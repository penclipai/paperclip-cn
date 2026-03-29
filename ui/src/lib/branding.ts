import { BRANDING } from "@penclipai/shared";

export const BRAND_NAME = BRANDING.productName;
export const BRAND_DOCS_URL = BRANDING.docsUrl;
export const BRAND_WEBSITE_URL = BRANDING.websiteUrl;
export const BRAND_REPOSITORY_URL = BRANDING.repositoryUrl;
export const BRAND_CHINA_WEBSITE_URL = BRANDING.chinaWebsiteUrl;

export function buildDocumentTitle(parts: string[] = []): string {
  return parts.length > 0 ? `${parts.join(" · ")} · ${BRAND_NAME}` : BRAND_NAME;
}
