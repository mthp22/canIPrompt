# CanIPrompt — Better prompts. Better code.

CanIPrompt answers one question: **is this prompt good enough to give to an
AI coding assistant, and how can you make it better?**

It evaluates the *instructions* you send to a coding model — requirements,
context, constraints, acceptance criteria, technical specificity, and
testability — and returns an overall score, a rubric breakdown, risks, and a
stronger rewritten prompt. Generated code can be scored separately against the
original prompt.

> **Two evaluation modes:** CanIPrompt scores with an AI evaluator when
> `OPENAI_API_KEY` is configured, and falls back to a deterministic keyword
> heuristic otherwise. Every response declares its mode: `"mode": "ai"` or
> `"mode": "heuristic"` in the API, and an `AI EVALUATED` / `HEURISTIC` tag in
> the UI. The heuristic is a rough signal, not an AI judgement, and it can be
> fooled by keywords — the UI states plainly which mode produced a score. If AI
> evaluation is configured but the provider fails, the request returns HTTP 503
> rather than quietly relabelling a heuristic score as an AI result.

## Stack

- **Frontend:** React 19, Vite 6, TypeScript
- **Backend:** Elysia.js on Bun, TypeBox schemas via Elysia validation
- **Testing:** `bun test` — API contract tests plus a deterministic benchmark
  suite
- **Deployment:** separate API (Docker/Bun) and static web services

## Project structure

```
caniprompt/
├── package.json            # Bun workspace root
├── render.yaml             # Render blueprint (API + static web)
├── .env.example
├── apps/
│   ├── api/
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── app.ts      # Elysia app, exported (no listener)
│   │   │   ├── index.ts    # entry point, starts the listener
│   │   │   └── evaluator.ts
│   │   └── test/
│   │       ├── api.test.ts
│   │       └── benchmarks.test.ts
│   └── web/
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── style.css
└── README.md
```

`app.ts` exports the configured Elysia app without opening a port, so tests
call `app.handle(...)` directly. `index.ts` is the only file that listens.

## Scoring rubric

| Dimension | Weight | What is assessed |
| --- | --- | --- |
| Requirements and goal clarity | 20% | Is the desired outcome explicit? |
| Context and existing code | 15% | Are relevant project details provided? |
| Constraints and boundaries | 15% | Are technologies, limitations, and exclusions specified? |
| Acceptance criteria | 20% | Can completion be verified? |
| Technical specificity | 15% | Are interfaces, behavior, and edge cases clear? |
| Testing and validation | 15% | Are tests and verification expectations defined? |

Each dimension scores 0–100; the weighted sum is the overall score
(server-calculated, never trusted from a client or model).

| Score | Verdict |
| --- | --- |
| 90–100 | Excellent — ready to use, subject to review |
| 75–89 | Good — minor improvements recommended |
| 50–74 | Needs work — important gaps remain |
| 0–49 | Weak — clarify the task before implementation |

These scores measure **prompt quality**, not a guarantee that an AI assistant
will generate correct software. The rubric version is returned as
`rubricVersion` on every response for benchmark bookkeeping.

## Local development

Requires [Bun](https://bun.sh) ≥ 1.x.

```bash
bun install
cp .env.example .env
bun run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000

Run tests and production builds:

```bash
bun run test
bun run build
```

Verify the API:

```bash
curl http://localhost:3000/health

# Which evaluator is active — "ai" or "heuristic"
curl http://localhost:3000/api/status

curl -X POST http://localhost:3000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Implement a TypeScript API endpoint with input validation, authorization, acceptance criteria, and unit tests."
  }'
```

## API

### `POST /api/evaluate`

```json
{
  "prompt": "Implement a TypeScript API endpoint with validation and tests...",
  "code": "export function example() { return true; }"
}
```

- `prompt` — required, 20–20,000 characters.
- `code` — optional, 1–40,000 characters. Static review only; code is never
  executed by the API.

Response: overall `score`, `verdict`, `mode` (`"ai"` or `"heuristic"`),
`rubricVersion`, per-dimension scores with reasons, `strengths`, `issues`,
`improvements`, a `rewrittenPrompt`, and — when `code` is supplied — a
`codeReview` (a real static review under AI evaluation, an honest stub under
the heuristic).

The overall score is always computed on the server from the weighted
dimensions; a model's claimed score is never trusted. Dimension scores are
clamped to 0–100 and every rubric key must be present, or the response is
rejected rather than partially returned.

Errors: `400` invalid body (TypeBox validation), `429` rate limited, `503`
AI evaluator configured but unavailable (never silently downgraded to a
heuristic score), `500` internal.

### `GET /api/status`

Tells the client which evaluator will run, so the UI can label scores honestly
and word the privacy note correctly.

```json
{ "evaluator": "ai", "model": "gpt-4.1-mini", "rubricVersion": "1.0" }
```

Without an API key: `{ "evaluator": "heuristic", "rubricVersion": "1.0" }`.

### `GET /health`

Returns `{ "status": "ok", "service": "caniprompt-api" }`.

## Tests and benchmarks

`apps/api/test/benchmarks.test.ts` is a regression suite, not a scientific
measurement of prompt quality. It verifies that a fully specified prompt
scores higher than a vague one, that scores stay within 0–100, and that rubric
weights sum to 100. `apps/api/test/api.test.ts` covers the contract: valid
input, schema limits, unexpected properties, rate limiting, and health.

## Security notes (MVP controls)

- Schema-enforced input size limits; also enforce body limits at the proxy.
- In-memory per-IP rate limiter (20 requests/60s) — **local MVP only**; use a
  shared limiter or API gateway for multiple instances, and configure trusted
  proxy handling explicitly.
- CORS restricted to `WEB_ORIGIN`.
- Security headers (`nosniff`, `no-referrer`, `no-store`) on all responses.
- No persistence of prompts or code; logs never contain prompts, source code,
  or keys.
- User-supplied code is never executed in the API process.
- Keep secrets server-side only; never in `VITE_*` variables.

## Deployment

`render.yaml` is a starting blueprint, not a verified deployment. Before
deploying:

1. Commit a lockfile (`bun install` generates `bun.lock`) so the Dockerfile's
   `--frozen-lockfile` build works.
2. Set `WEB_ORIGIN` to the deployed frontend origin and `VITE_API_URL` to the
   deployed API origin.
3. Set `OPENAI_API_KEY` (a server-side secret) and, optionally, `OPENAI_MODEL`
   to enable AI evaluation. Leave the key unset to run heuristic-only.
4. Configure DNS/HTTPS for `leborengmathope.dev` (pick a canonical hostname
   and redirect the other).

## Roadmap

- **Phase 1 (done):** prompt editor, six scoring dimensions, heuristic mode,
  rewritten prompts, optional code-review slot, API validation.
- **Phase 2 (in progress):** ✅ AI evaluator with structured JSON output, honest
  mode labelling, `/api/status`, provider-failure → 503, mocked-provider test
  suite. Remaining: benchmark calibration against human reference ratings,
  distributed rate limiting, privacy/retention controls, spending limits.
- **Phase 3:** prompt version history, side-by-side comparisons,
  framework-specific rubrics, reusable templates, sandboxed test execution.
