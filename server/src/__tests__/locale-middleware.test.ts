import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { localeMiddleware } from "../middleware/locale.js";

describe("localeMiddleware", () => {
  it("marks localized responses as varying by Accept-Language", () => {
    const req = {
      get: vi.fn().mockReturnValue("en-US,en;q=0.9"),
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      vary: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    localeMiddleware(req, res, next);

    expect(req.locale).toBe("en");
    expect(res.vary).toHaveBeenCalledWith("Accept-Language");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Language", "en");
    expect(next).toHaveBeenCalledOnce();
  });
});
