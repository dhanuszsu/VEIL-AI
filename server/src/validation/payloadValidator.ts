import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  ClientPayloadSchema,
  validateClientPayload,
  ClientPayload,
  MAX_PAYLOAD_SIZE,
} from "@privatesight/shared";

export const payloadSizeLimit = MAX_PAYLOAD_SIZE;

export function validatePayload(req: Request, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.get("content-length") || "0", 10);
  if (contentLength > MAX_PAYLOAD_SIZE) {
    res.status(413).json({
      error: "Payload too large",
      maxSize: MAX_PAYLOAD_SIZE,
      receivedSize: contentLength,
    });
    return;
  }

  try {
    const payload = validateClientPayload(req.body);
    req.body = payload;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid payload",
        details: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    res.status(400).json({ error: "Invalid payload format" });
  }
}

export function sanitizeOriginCheck(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin") || req.get("referer") || "";
  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "chrome-extension://",
    "moz-extension://",
  ];

  const isAllowed = allowedOrigins.some((allowed) =>
    origin.startsWith(allowed)
  );

  if (!isAllowed && process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  next();
}

export function rateLimiter(
  maxRequests: number = 30,
  windowMs: number = 60_000
): (req: Request, res: Response, next: NextFunction) => void {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    const userRequests = requests.get(ip) || [];
    const recentRequests = userRequests.filter((ts) => ts > windowStart);

    if (recentRequests.length >= maxRequests) {
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfterMs: windowMs - (now - recentRequests[0]),
      });
      return;
    }

    recentRequests.push(now);
    requests.set(ip, recentRequests);

    if (requests.size > 1000) {
      const oldestKey = requests.keys().next().value;
      if (oldestKey) requests.delete(oldestKey);
    }

    next();
  };
}