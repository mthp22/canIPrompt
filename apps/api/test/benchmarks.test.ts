import { describe, expect, test } from "bun:test";
import {
  DIMENSIONS,
  heuristicEvaluate
} from "../src/evaluator";

const benchmarks = [
  {
    name: "vague implementation request",
    prompt: "Build an app.",
    maxScore: 60
  },
  {
    name: "implementation with tests and criteria",
    prompt: `Implement a TypeScript API endpoint for creating projects.
Use the existing API conventions and validate the request schema.
Return HTTP 201 on success and HTTP 400 for invalid input.
Acceptance criteria:
- Unauthorized requests are rejected.
- Invalid names return a consistent error response.
- Unit tests cover success, validation, and authorization.
Testing: run the unit and integration tests.`,
    minScore: 70
  }
];

describe("CanIPrompt benchmark suite", () => {
  for (const benchmark of benchmarks) {
    test(benchmark.name, () => {
      const result = heuristicEvaluate({
        prompt: benchmark.prompt
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);

      if ("maxScore" in benchmark) {
        expect(result.score).toBeLessThanOrEqual(benchmark.maxScore);
      }

      if ("minScore" in benchmark) {
        expect(result.score).toBeGreaterThanOrEqual(
          benchmark.minScore
        );
      }
    });
  }

  test("scores a fully specified prompt higher than a vague prompt", () => {
    const vague = heuristicEvaluate({
      prompt: "Build an app."
    });

    const detailed = heuristicEvaluate({
      prompt: benchmarks[1]!.prompt
    });

    expect(detailed.score).toBeGreaterThan(vague.score);
  });

  test("keeps the weights at 100 percent", () => {
    expect(
      DIMENSIONS.reduce((sum, item) => sum + item.weight, 0)
    ).toBe(100);
  });

  test("is deterministic for the same input", () => {
    const first = heuristicEvaluate({
      prompt: benchmarks[1]!.prompt
    });

    const second = heuristicEvaluate({
      prompt: benchmarks[1]!.prompt
    });

    expect(second).toEqual(first);
  });

  test("labels every result as heuristic", () => {
    const result = heuristicEvaluate({
      prompt: benchmarks[1]!.prompt
    });

    expect(result.mode).toBe("heuristic");
    expect(typeof result.rubricVersion).toBe("string");
  });
});
