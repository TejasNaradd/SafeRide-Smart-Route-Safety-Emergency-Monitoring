import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type AuthenticatedRequest = Request & { userId?: string };

const secret = () => {
  const value = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!value) throw new Error("JWT_SECRET or SESSION_SECRET must be configured.");
  return value;
};

export function createToken(userId: string): string {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: "7d" });
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), secret()) as jwt.JwtPayload;
    if (typeof decoded.sub !== "string") throw new Error("Missing subject");
    req.userId = decoded.sub;
    next();
  } catch (error) {
    req.log.warn({ err: error }, "Invalid bearer token");
    res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
}

export function publicUser(row: { id: string; name: string; email: string }) {
  return { id: row.id, name: row.name, email: row.email };
}

export function hashForDeviceFallback(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}