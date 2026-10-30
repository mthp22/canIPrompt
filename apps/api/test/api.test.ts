import { afterEach, beforeEach, expect, test } from "bun:test";
import { app, resetRateLimiter } from "../src/app";
import { setCompletionFn, DIMENSIONS } from "../src/evaluator";

const EVALUATE_URL = "http://localhost/api/evaluate";
const STATUS_URL = "http://localhost/api/status";

// Pin evaluator config for the whole file so tests are hermetic.
// Bun reads process.env lazily at call time, so setting these at module
// scope keeps every test deterministic regardless of the host .env.
const ENV_KEYS = [
  "EVAL_PROVIDER",
  "OLLAMA_MODEL",
  "OLLAMA_HOST",
  "OPENAI_API_KEY",
  "OPENAI_MODEL"
] as const;

const savedEnv: Record<string, string | undefined> = {};

for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

// Default to heuristic mode for this file so "no AI configured" paths are
// deterministic and never reach a live provider. AI-path tests set an
// explicit EVAL_PROVIDER (or inject a completion stub) to opt back in.
process.env.EVAL_PROVIDER = "heuristic";

// Restore the host environment when this file's tests finish.
process.on("exit", () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const validPrompt = `Implement a TypeScript REST endpoint for creating projects.
Validate the request body and reject invalid names with HTTP 400.
Return the created project with HTTP 201.
Acceptance criteria:
- Unauthorized requests are rejected.
- Unit tests cover success and validation failures.
Testing: include unit tests for the handler.`;

function post(body: unknown) {
  return app.handle(
    new Request(EVALUATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    })
  );
}

beforeEach(() => {
  resetRateLimiter();
  // Start each test from a known-clean evaluator state.
  setCompletionFn(undefined);
  delete process.env.OPENAI_API_KEY;
});

test("health check returns 200", async () => {
  const response = await app.handle(
    new Request("http://localhost/health")
  );

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.status).toBe("ok");
  expect(data.service).toBe("caniprompt-api");
});

test("evaluates a valid prompt with all six dimensions", async () => {
  const response = await post({ prompt: validPrompt });

  expect(response.status).toBe(200);

  const data = await response.json();

  expect(data.mode).toBe("heuristic");
  expect(typeof data.rubricVersion).toBe("string");
  expect(data.score).toBeGreaterThanOrEqual(0);
  expect(data.score).toBeLessThanOrEqual(100);
  expect(typeof data.verdict).toBe("string");
  expect(typeof data.rewrittenPrompt).toBe("string");
  expect(Array.isArray(data.strengths)).toBe(true);
  expect(Array.isArray(data.issues)).toBe(true);
  expect(Array.isArray(data.improvements)).toBe(true);

  expect(data.dimensions).toHaveLength(6);

  const totalWeight = data.dimensions.reduce(
    (sum: number, d: { weight: number }) => sum + d.weight,
    0
  );
  expect(totalWeight).toBe(100);

  for (const dimension of data.dimensions) {
    expect(typeof dimension.key).toBe("string");
    expect(typeof dimension.label).toBe("string");
    expect(typeof dimension.score).toBe("number");
    expect(dimension.score).toBeGreaterThanOrEqual(0);
    expect(dimension.score).toBeLessThanOrEqual(100);
    expect(typeof dimension.reason).toBe("string");
  }
});

test("returns an honest code-review stub when code is supplied", async () => {
  const response = await post({
    prompt: validPrompt,
    code: "export function example() { return true; }"
  });

  expect(response.status).toBe(200);

  const data = await response.json();

  expect(data.codeReview).toBeDefined();
  expect(data.codeReview.score).toBe(0);
  expect(Array.isArray(data.codeReview.findings)).toBe(true);
  expect(typeof data.codeReview.caveat).toBe("string");
});

test("rejects prompts that are too short", async () => {
  const response = await post({ prompt: "Too short" });

  expect(response.status).toBe(400);

  const data = await response.json();
  expect(data.code).toBe("VALIDATION");
});

test("rejects a missing prompt", async () => {
  const response = await post({});

  expect(response.status).toBe(400);
});

test("rejects oversized prompts", async () => {
  const response = await post({ prompt: "x".repeat(20_001) });

  expect(response.status).toBe(400);
});

test("rejects oversized code", async () => {
  const response = await post({
    prompt: validPrompt,
    code: "y".repeat(40_001)
  });

  expect(response.status).toBe(400);
});

test("rejects unexpected request properties", async () => {
  const response = await post({
    prompt: validPrompt,
    unexpected: "field"
  });

  expect(response.status).toBe(400);
});

test("returns 429 after exceeding the rate limit", async () => {
  // 20 requests fit in the window; the 21st is rejected.
  const statuses: number[] = [];

  for (let i = 0; i < 21; i++) {
    const response = await post({ prompt: validPrompt });
    statuses.push(response.status);
  }

  expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
  expect(statuses[20]).toBe(429);
});

test("status reports heuristic mode with no key configured", async () => {
  const response = await app.handle(new Request(STATUS_URL));

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.evaluator).toBe("heuristic");
  expect(data.model).toBeUndefined();
  expect(typeof data.rubricVersion).toBe("string");
});

test("status reports ai mode when a key is configured", async () => {
  process.env.EVAL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";

  const response = await app.handle(new Request(STATUS_URL));

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.evaluator).toBe("ai");
  expect(typeof data.model).toBe("string");
});

test("maps evaluator failure to 503 without leaking details", async () => {
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  setCompletionFn(async () => {
    throw new Error("provider leaked secret sk-test-not-a-real-key");
  });

  const response = await post({ prompt: validPrompt });

  expect(response.status).toBe(503);

  const text = await response.text();
  expect(text).not.toContain("sk-test-not-a-real-key");
  expect(text).not.toContain("provider leaked");

  const data = JSON.parse(text);
  expect(data.code).toBe("EVALUATOR_UNAVAILABLE");
});

test("returns an AI evaluation when the provider responds", async () => {
  setCompletionFn(async () =>
    JSON.stringify({
      dimensions: DIMENSIONS.map((d) => ({
        key: d.key,
        score: 88,
        reason: `Reason for ${d.key}.`
      })),
      strengths: ["Well specified."],
      issues: [],
      improvements: ["Add rollback steps."],
      rewrittenPrompt: "Improved prompt.",
      codeReview: null
    })
  );

  const response = await post({ prompt: validPrompt });

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.mode).toBe("ai");
  expect(data.score).toBe(88);
  expect(data.verdict).toBe("Good");
  expect(data.rewrittenPrompt).toBe("Improved prompt.");
});
