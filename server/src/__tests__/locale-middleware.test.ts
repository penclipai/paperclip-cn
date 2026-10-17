import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { localeMiddleware, localeResponseHeadersMiddleware } from "../middleware/locale.js";

describe("localeMiddleware", () => {
  it("attaches locale helpers to the request", () => {
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
    expect(req.t("errors.validation")).toBe("Validation error");
    expect(res.vary).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("marks API responses as varying by Accept-Language", () => {
    const req = {
      locale: "en",
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      vary: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    localeResponseHeadersMiddleware(req, res, next);

    expect(res.vary).toHaveBeenCalledWith("Accept-Language");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Language", "en");
    expect(next).toHaveBeenCalledOnce();
  });

  it("localizes malformed JSON errors when locale is known before body parsing", async () => {
    const app = express();
    app.use(localeMiddleware);
    app.use("/api", localeResponseHeadersMiddleware);
    app.use(express.json());
    app.post("/api/test", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/test")
      .set("Accept-Language", "zh-CN")
      .set("Content-Type", "application/json")
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "无效的 JSON 请求体" });
    expect(res.headers["content-language"]).toBe("zh-CN");
  });
});
