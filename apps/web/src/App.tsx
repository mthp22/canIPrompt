import { useState } from "react";

type Dimension = {
  key: string;
  label: string;
  weight: number;
  score: number;
  reason: string;
};

type Result = {
  mode: "ai" | "heuristic";
  rubricVersion: string;
  score: number;
  verdict: string;
  dimensions: Dimension[];
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

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

const example = `Implement a TypeScript REST API endpoint for creating a project.

Requirements:
- Validate the request body.
- Reject invalid project names with HTTP 400.
- Return the created project with HTTP 201.
- Prevent unauthorized requests.
- Include unit tests for valid input, invalid input, and authorization failures.

Constraints:
- Follow the existing API conventions.
- Do not introduce unnecessary dependencies.

Acceptance criteria:
- All required tests pass.
- Error responses use a consistent JSON structure.
- Document the endpoint and its validation rules.`;

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [includeCode, setIncludeCode] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleEvaluate() {
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch(`${API_URL}/api/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ...(includeCode && code ? { code } : {})
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Evaluation failed");
      }

      setResult(data as Result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to connect to the API."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.rewrittenPrompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">C</span>
          CanIPrompt
        </a>
        <span className="topbar-note">BUILT FOR CODING WITH AI</span>
      </header>

      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot" aria-hidden="true" />
          PROMPT QUALITY WORKBENCH
        </div>
        <h1>
          Better prompts.
          <br />
          <span>Better code.</span>
        </h1>
        <p>
          Evaluate the instructions you give your coding assistant.
          Find gaps, tighten requirements, and ship with confidence.
        </p>
      </section>

      <section className="workspace">
        <div className="panel editor-panel">
          <div className="panel-header">
            <div>
              <span className="step">01</span>
              <h2>Your coding prompt</h2>
            </div>
            <span className="counter">
              {prompt.length.toLocaleString()} / 20,000
            </span>
          </div>

          <textarea
            aria-label="Coding prompt"
            maxLength={20000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the task you want your AI coding assistant to complete..."
          />

          <button
            className="text-button"
            onClick={() => setPrompt(example)}
            type="button"
          >
            Load example prompt ↗
          </button>

          <div className="code-option">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={includeCode}
                onChange={(e) => setIncludeCode(e.target.checked)}
              />
              <span>
                <strong>Evaluate generated code too</strong>
                <small>Optional static review against this prompt</small>
              </span>
            </label>
          </div>

          {includeCode && (
            <textarea
              className="code-input"
              aria-label="Generated code"
              maxLength={40000}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the generated source code here..."
            />
          )}

          <button
            className="primary-button"
            disabled={loading || prompt.trim().length < 20}
            onClick={handleEvaluate}
            type="button"
          >
            {loading ? "Evaluating…" : "Evaluate prompt"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>

          <p className="privacy-note">
            Your prompt and any pasted code are sent to this app's API
            for analysis and are not stored. Scoring in this version is
            deterministic, not AI-generated. Do not submit secrets or
            credentials.
          </p>
        </div>

        <div className="panel results-panel" aria-live="polite">
          {!result && !loading && !error && (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">✳</div>
              <span className="step">YOUR RESULTS</span>
              <h2>Clarity starts here.</h2>
              <p>
                Your score, rubric breakdown, and improvement plan
                will appear here after evaluation.
              </p>
              <div className="preview-metric">
                <span>01</span>
                <div>
                  <strong>Prompt clarity</strong>
                  <small>Make the goal unambiguous</small>
                </div>
              </div>
              <div className="preview-metric">
                <span>02</span>
                <div>
                  <strong>Acceptance criteria</strong>
                  <small>Define what done means</small>
                </div>
              </div>
              <div className="preview-metric">
                <span>03</span>
                <div>
                  <strong>Testability</strong>
                  <small>Make correctness verifiable</small>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="empty-state">
              <div className="loader" aria-hidden="true" />
              <h2>Reading between the lines.</h2>
              <p>Evaluating requirements, constraints, and testability…</p>
            </div>
          )}

          {error && (
            <div className="empty-state error-state">
              <h2>Evaluation unavailable</h2>
              <p>{error}</p>
              <button
                className="secondary-button"
                onClick={handleEvaluate}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {result && (
            <div className="result-content">
              <div className="result-topline">
                <span className="step">EVALUATION REPORT</span>
                <span className="mode-tag">
                  {result.mode === "ai" ? "AI EVALUATED" : "HEURISTIC"}
                </span>
              </div>

              <div className="score-block">
                <div className="score-number">{result.score}</div>
                <div>
                  <h2>{result.verdict}</h2>
                  <p>Overall prompt quality</p>
                </div>
              </div>

              <div className="score-track">
                <div style={{ width: `${result.score}%` }} />
              </div>

              <h3>Rubric breakdown</h3>
              <div className="dimensions">
                {result.dimensions.map((d) => (
                  <div className="dimension" key={d.key}>
                    <div className="dimension-top">
                      <span>{d.label}</span>
                      <strong>{d.score}</strong>
                    </div>
                    <div className="mini-track">
                      <div style={{ width: `${d.score}%` }} />
                    </div>
                    <p>{d.reason}</p>
                  </div>
                ))}
              </div>

              {result.strengths.length > 0 && (
                <>
                  <h3>What's working</h3>
                  <ul className="result-list">
                    {result.strengths.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </>
              )}

              <h3>What to improve</h3>
              <ul className="result-list">
                {[...result.issues, ...result.improvements].map(
                  (item, i) => <li key={i}>{item}</li>
                )}
              </ul>

              <h3>Suggested prompt</h3>
              <pre className="rewritten-prompt">
                {result.rewrittenPrompt}
              </pre>
              <button
                className="secondary-button"
                onClick={handleCopy}
                type="button"
              >
                {copied ? "Copied!" : "Copy improved prompt"}
              </button>
              <span className="visually-hidden" role="status">
                {copied ? "Improved prompt copied to clipboard." : ""}
              </span>

              {result.codeReview && (
                <>
                  <h3>Generated-code review</h3>
                  <p>
                    Static review score: {result.codeReview.score}/100
                  </p>
                  <ul className="result-list">
                    {result.codeReview.findings.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  <p className="privacy-note">
                    {result.codeReview.caveat}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <footer>
        <span>CanIPrompt</span>
        <span>Make every instruction count.</span>
      </footer>
    </main>
  );
}
