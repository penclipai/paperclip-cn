import type { NextFunction, Request, Response } from "express";
import { resolveRequestLocale, translate } from "../i18n.js";

export function localeMiddleware(req: Request, res: Response, next: NextFunction) {
  const locale = resolveRequestLocale(req.get("Accept-Language"));
  req.locale = locale;
  req.t = (key, params) => translate(locale, key, params);
  res.vary("Accept-Language");
  res.setHeader("Content-Language", locale);
  next();
}
