export const RUBRIC_VERSION = "1.0";

export const DIMENSIONS = [
  {
    key: "clarity",
    label: "Requirements and goal clarity",
    weight: 20
  },
  {
    key: "context",
    label: "Context and existing code",
    weight: 15
  },
  {
    key: "constraints",
    label: "Constraints and boundaries",
    weight: 15
  },
  {
    key: "acceptance",
    label: "Acceptance criteria",
    weight: 20
  },
  {
    key: "specificity",
    label: "Technical specificity",
    weight: 15
  },
  {
    key: "testing",
    label: "Testing and validation",
    weight: 15
  }
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

export type Evaluation = {
  mode: "ai" | "heuristic";
  rubricVersion: string;
  score: number;
  verdict: string;
  dimensions: {
    key: DimensionKey;
    label: string;
    weight: number;
    score: number;
    reason: string;
  }[];
  strengths: string[];
  issues: string[];
  improvements: string[];
  rewrittenPrompt: string;
  codeReview?: {
    score: number;
    findings: string[];
    caveat: string;
  };
};

export type Input = {
  prompt: string;
  code?: string;
};

function scoreVerdict(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs work";
  return "Weak";
}

function weightedScore(
  dimensions: { score: number; weight: number }[]
): number {
  return Math.round(
    dimensions.reduce(
      (sum, d) => sum + (d.score * d.weight) / 100,
      0
    )
  );
}

const REASONS: Record<
  DimensionKey,
  { present: string; missing: string }
> = {
  clarity: {
    present: "An implementation goal is identifiable.",
    missing: "State the intended outcome and user-visible behavior."
  },
  context: {
    present: "Some project context is provided.",
    missing:
      "Describe the existing codebase, environment, or assumptions."
  },
  constraints: {
    present:
      "Some technical or behavioral constraints are explicit.",
    missing:
      "Specify required technologies, boundaries, and exclusions."
  },
  acceptance: {
    present: "Potential completion criteria are present.",
    missing:
      "Define observable acceptance criteria and expected results."
  },
  specificity: {
    present: "Technical implementation details are present.",
    missing:
      "Identify important interfaces, data structures, or edge cases."
  },
  testing: {
    present: "Testing or validation is mentioned.",
    missing:
      "Require tests and describe how correctness will be verified."
  }
};

export function heuristicEvaluate(input: Input): Evaluation {
  const p = input.prompt;

  const hasGoal =
    /\b(build|create|implement|develop|fix|refactor|design)\b/i.test(
      p
    );

  const hasContext =
    /\b(existing|currently|project|codebase|using|built with|stack|framework)\b/i.test(
      p
    );

  const hasConstraints =
    /\b(must|must not|only|avoid|constraint|typescript|security|performance)\b/i.test(
      p
    );

  const hasAcceptance =
    /\b(acceptance criteria|expected result|should return|definition of done|success criteria)\b/i.test(
      p
    ) || /(^|\n)\s*[-*]\s/.test(p);

  const hasSpecificity =
    /\b(api|endpoint|schema|component|function|database|interface|error handling)\b/i.test(
      p
    );

  const hasTesting =
    /\b(test|tests|testing|unit test|integration test|edge case|validation)\b/i.test(
      p
    );

  const flags: Record<DimensionKey, boolean> = {
    clarity: hasGoal,
    context: hasContext,
    constraints: hasConstraints,
    acceptance: hasAcceptance,
    specificity: hasSpecificity,
    testing: hasTesting
  };

  const presentScores: Record<DimensionKey, number> = {
    clarity: 85,
    context: 80,
    constraints: 85,
    acceptance: 85,
    specificity: 80,
    testing: 90
  };

  const missingScores: Record<DimensionKey, number> = {
    clarity: 25,
    context: 30,
    constraints: 30,
    acceptance: 25,
    specificity: 30,
    testing: 20
  };

  const dimensions = DIMENSIONS.map((d) => ({
    ...d,
    score: flags[d.key] ? presentScores[d.key] : missingScores[d.key],
    reason: flags[d.key]
      ? REASONS[d.key].present
      : REASONS[d.key].missing
  }));

  const score = weightedScore(dimensions);

  const issues = dimensions
    .filter((d) => d.score < 60)
    .map((d) => d.reason);

  const improvements = [
    !hasContext &&
      "Describe the project context and existing implementation.",
    !hasConstraints && "Specify the required stack and constraints.",
    !hasAcceptance && "Add observable acceptance criteria.",
    !hasSpecificity &&
      "Define relevant interfaces, inputs, outputs, and edge cases.",
    !hasTesting &&
      "Require tests and explain how to verify the result."
  ].filter((v): v is string => typeof v === "string");

  return {
    mode: "heuristic",
    rubricVersion: RUBRIC_VERSION,
    score,
    verdict: scoreVerdict(score),
    dimensions,
    strengths: [
      ...(hasGoal
        ? ["An identifiable implementation goal is present."]
        : []),
      ...(hasTesting
        ? ["Testing is explicitly mentioned."]
        : [])
    ],
    issues,
    improvements,
    rewrittenPrompt:
      `${p.trim()}\n\n` +
      "Additional instructions to consider:\n" +
      "- State assumptions and constraints explicitly.\n" +
      "- Define observable acceptance criteria.\n" +
      "- Include appropriate automated tests.\n" +
      "- Report limitations and any unverified behavior.",
    ...(input.code
      ? {
          codeReview: {
            score: 0,
            findings: [
              "Static code review requires an AI evaluator; no code execution was performed."
            ],
            caveat:
              "This is not a code-quality score. AI-assisted code review is not enabled in this deployment."
          }
        }
      : {})
  };
}

/**
 * Evaluator entry point.
 *
 * This build ships the deterministic heuristic only; every response is
 * labelled `mode: "heuristic"`. An AI evaluator is planned for a later
 * phase and must never silently fall back to the heuristic — if AI
 * evaluation is configured but fails, the request should fail loudly
 * instead of relabelling a heuristic score as an AI result.
 */
export async function evaluate(input: Input): Promise<Evaluation> {
  return heuristicEvaluate(input);
}
