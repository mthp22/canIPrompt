import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  evaluate,
  heuristicEvaluate,
  resolveProvider,
  setCompletionFn,
  validateAIResult,
  DIMENSIONS
} from "../src/evaluator";

const prompt = "Implement a TypeScript API endpoint with tests.";

// Pin evaluator config for the whole file so tests are hermetic.
// Bun reads process.env lazily, so module-scope assignment keeps each
// test deterministic regardless of the host .env.
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

process.on("exit", () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// A well-formed provider payload. The server computes the overall
// score itself, so the model omits it deliberately.
function goodPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    dimensions: DIMENSIONS.map((d) => ({
      key: d.key,
      score: 90,
      reason: `Reason for ${d.key}.`
    })),
    strengths: ["Clear goal."],
    issues: [],
    improvements: ["Add edge-case tests."],
    rewrittenPrompt: "Rewritten prompt text.",
    codeReview: null,
    ...overrides
  });
}

function payloadWithDimensions(
  dims: { key: string; score: unknown; reason?: unknown }[]
) {
  return JSON.stringify({
    dimensions: dims,
    strengths: [],
    issues: [],
    improvements: [],
    rewrittenPrompt: "Rewritten prompt text.",
    codeReview: null
  });
}

beforeEach(() => {
  // Start each test from a known-clean evaluator state. Module scope
  // already cleared the env; tests that need a value set it explicitly.
  setCompletionFn(undefined);
  delete process.env.OPENAI_API_KEY;
});

test("falls back to the heuristic when no key and no stub exist", async () => {
  const result = await evaluate({ prompt });

  expect(result.mode).toBe("heuristic");
  expect(result.rubricVersion).toBeTypeOf("string");
});

test("uses the injected completion and returns mode 'ai'", async () => {
  setCompletionFn(async () => goodPayload());

  const result = await evaluate({ prompt });

  expect(result.mode).toBe("ai");
  expect(result.score).toBe(90);
  expect(result.verdict).toBe("Excellent");
  expect(result.rewrittenPrompt).toBe("Rewritten prompt text.");
  expect(result.dimensions).toHaveLength(6);
});

test("recalculates the overall score from weighted dimensions", async () => {
  setCompletionFn(async () =>
    payloadWithDimensions(
      DIMENSIONS.map((d) => ({
        key: d.key,
        score: 80,
        reason: "ok"
      }))
    )
  );

  const result = await evaluate({ prompt });

  expect(result.score).toBe(80);
});

test("throws EvaluatorUnavailableError when the provider fails", async () => {
  setCompletionFn(async () => {
    throw new Error("upstream boom");
  });

  await expect(evaluate({ prompt })).rejects.toThrow(
    "AI evaluation temporarily unavailable"
  );
});

test("throws on empty provider content", async () => {
  setCompletionFn(async () => {
    throw new Error("Empty evaluator response");
  });

  await expect(evaluate({ prompt })).rejects.toThrow(
    "AI evaluation temporarily unavailable"
  );
});

test("throws rather than mislabeling a malformed payload", async () => {
  setCompletionFn(async () => "this is not json");

  await expect(evaluate({ prompt })).rejects.toThrow(
    "AI evaluation temporarily unavailable"
  );
});

test("clamps out-of-range dimension scores", () => {
  const result = validateAIResult(
    JSON.parse(
      payloadWithDimensions(
        DIMENSIONS.map((d) => ({
          key: d.key,
          score: 250,
          reason: "too high"
        }))
      )
    ),
    { prompt }
  );

  for (const d of result.dimensions) {
    expect(d.score).toBe(100);
  }
  expect(result.score).toBe(100);
});

test("rejects a payload missing a dimension", () => {
  expect(() =>
    validateAIResult(
      JSON.parse(
        payloadWithDimensions(
          DIMENSIONS.filter((d) => d.key !== "testing").map((d) => ({
            key: d.key,
            score: 80,
            reason: "ok"
          }))
        )
      ),
      { prompt }
    )
  ).toThrow("Missing dimension: testing");
});

test("includes a codeReview only when code was supplied", async () => {
  setCompletionFn(async () =>
    goodPayload({
      codeReview: {
        score: 70,
        findings: ["Missing null check."],
        caveat: "Static review only."
      }
    })
  );

  const withoutCode = await evaluate({ prompt });
  const withCode = await evaluate({
    prompt,
    code: "export const x = 1;"
  });

  expect(withoutCode.codeReview).toBeUndefined();
  expect(withCode.codeReview?.score).toBe(70);
  expect(withCode.codeReview?.findings).toEqual(["Missing null check."]);
});

test("heuristic scores a detailed prompt higher than a vague one", () => {
  const vague = heuristicEvaluate({ prompt: "Build an app." });
  const detailed = heuristicEvaluate({ prompt });

  expect(detailed.score).toBeGreaterThan(vague.score);
});

describe("provider resolution", () => {
  test("defaults to local Ollama with qwen2.5:1.5b", () => {
    delete process.env.EVAL_PROVIDER;
    const resolved = resolveProvider();

    expect(resolved).toEqual({
      provider: "ollama",
      model: "qwen2.5:1.5b"
    });
  });

  test("honours an explicit OLLAMA_MODEL", () => {
    delete process.env.EVAL_PROVIDER;
    process.env.OLLAMA_MODEL = "llama3.2:3b";

    expect(resolveProvider()).toEqual({
      provider: "ollama",
      model: "llama3.2:3b"
    });
  });

  test("prefers OpenAI when a key is configured", () => {
    delete process.env.EVAL_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt-4.1-mini";

    expect(resolveProvider()).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini"
    });
  });

  test("honours an explicit ollama override even with an OpenAI key", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.EVAL_PROVIDER = "ollama";

    expect(resolveProvider()?.provider).toBe("ollama");
  });

  test("honours an explicit openai override", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.EVAL_PROVIDER = "openai";

    expect(resolveProvider()?.provider).toBe("openai");
  });

  test("an explicit openai override without a key falls back to heuristic", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.EVAL_PROVIDER = "openai";

    expect(resolveProvider()).toBeUndefined();
  });

  test("an explicit heuristic override disables AI even with config present", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OLLAMA_MODEL = "qwen2.5:1.5b";
    process.env.EVAL_PROVIDER = "heuristic";

    expect(resolveProvider()).toBeUndefined();
  });

  test("no config at all means Ollama (works with zero cloud credentials)", () => {
    delete process.env.EVAL_PROVIDER;
    const resolved = resolveProvider();

    expect(resolved?.provider).toBe("ollama");
  });
});
