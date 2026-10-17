import type { Request } from "express";
import { translate, type TranslationParams } from "./i18n.js";

export function translateRequest(
  req: Request,
  key: string,
  params?: TranslationParams,
): string {
  return typeof req.t === "function" ? req.t(key, params) : translate("en", key, params);
}
