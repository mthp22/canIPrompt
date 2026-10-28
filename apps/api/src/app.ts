import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { evaluate } from "./evaluator";

const MAX_PROMPT_LENGTH = 20_000;
const MAX_CODE_LENGTH = 40_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

const buckets = new Map<string, { count: number; reset: number }>();

/**
 * Test helper: clears rate-limit state so tests cannot leak into
 * each other through the shared per-IP bucket.
 */
export function resetRateLimiter() {
  buckets.clear();
}

function allowRequest(ip: string) {
  const now = Date.now();
  const current = buckets.get(ip);

  if (!current || current.reset <= now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }

  if (current.count >= MAX_REQUESTS) return false;

  current.count++;
  return true;
}

// Sweep expired buckets so the map does not grow without bound.
// unref() keeps this timer from holding the process (or bun test) open.
const cleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (bucket.reset <= now) buckets.delete(ip);
    }
  },
  WINDOW_MS
);
cleanupTimer.unref?.();

// Production hardening: the in-memory limiter is intentionally a
// local-MVP implementation. For multiple API instances, use a shared
// Redis-backed limiter or enforce limits at the API gateway. Configure
// trusted proxy handling explicitly; do not trust arbitrary
// client-supplied IP headers.

// normalize: false makes Elysia reject unknown body properties
// (422, mapped to 400 in onError) instead of silently stripping them.
export const app = new Elysia({ normalize: false })
  .use(
    cors({
      origin: (process.env.WEB_ORIGIN || "http://localhost:5173")
        .split(",")
        .map((value) => value.trim()),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["content-type"]
    })
  )
  .onRequest(({ request, set }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["referrer-policy"] = "no-referrer";
    set.headers["cache-control"] = "no-store";

    const path = new URL(request.url).pathname;

    if (path === "/health") return;

    // Bun's server exposes the connecting address through requestIP.
    const ip = app.server?.requestIP(request)?.address ?? "unknown";

    if (!allowRequest(ip)) {
      set.status = 429;
      throw new Error("Rate limit exceeded");
    }
  })
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "Invalid request", code: "VALIDATION" };
    }

    if (error.message === "Rate limit exceeded") {
      set.status = 429;
      return { error: "Too many requests. Try again shortly." };
    }

    // Log the message only. Never log prompts, source code, API keys,
    // or complete upstream error responses.
    console.error("API error:", error.message);
    set.status = 500;
    return { error: "Internal server error" };
  })
  .get("/health", () => ({
    status: "ok",
    service: "caniprompt-api"
  }))
  .post(
    "/api/evaluate",
    async ({ body }) => evaluate(body),
    {
      // additionalProperties: false + app-level normalize: false rejects
      // unknown properties instead of silently stripping them.
      body: t.Object(
        {
          prompt: t.String({
            minLength: 20,
            maxLength: MAX_PROMPT_LENGTH
          }),
          code: t.Optional(
            t.String({
              minLength: 1,
              maxLength: MAX_CODE_LENGTH
            })
          )
        },
        { additionalProperties: false }
      ),
      detail: {
        summary: "Evaluate an AI coding prompt",
        description:
          "Evaluates prompt quality and optionally reviews generated code."
      }
    }
  );
