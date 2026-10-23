import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

export function tokenMatches(candidate: string | null | undefined): boolean {
  if (!config.api.token) return true;
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.api.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer-token guard, active only when API_TOKEN is set. */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (tokenMatches(token)) return next();
  res.status(401).json({ error: "Missing or invalid API token" });
}

/** Operator name recorded in the audit log for manual overrides. */
export function actorOf(req: Request): string {
  const raw = req.header("x-actor") ?? "operator";
  return raw.replace(/[^\w .@-]/g, "").slice(0, 64) || "operator";
}
