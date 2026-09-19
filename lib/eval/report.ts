/**
 * The evaluation report (§10.5).
 *
 * Kept pure so the classification and tallying can be unit-tested without running a model,
 * and so the same report shape is produced by the CLI, the `eval.run` job, and anything
 * that later reads stored results.
 *
 * Two kinds of check, because they are not the same claim:
 *
 *  - **assertions** are pass/fail requirements — "the answer key is one of the options".
 *    They decide whether the run passed.
 *  - **metrics** are model-graded scores — "is this answer grounded?". They are recorded
 *    and displayed, and flagged when below their floor, but they do not decide the run.
 *    Measured across three runs of the same suite against the same fixture, one criterion
 *    scored 0.30, 0.85 and 1.00: a model grading a model is a noisy instrument. §10.5's
 *    answer is a committed baseline to diff against, which is later work; until then a
 *    noisy number must not be able to turn the harness red on its own.
 */

export type EvalSuite = "tutor" | "retrieval" | "assessment" | "recommendations";

export const EVAL_SUITES: EvalSuite[] = ["tutor", "retrieval", "assessment", "recommendations"];

export type EvalCheckKind = "assertion" | "metric";

export type EvalCheck = {
  suite: EvalSuite;
  /** What was checked, in the imperative: "citations resolve to real material". */
  name: string;
  kind: EvalCheckKind;
  passed: boolean;
  /** Evidence for the verdict — counts, ids, or the reason it failed. */
  detail: string;
};

export type EvalTally = { passed: number; failed: number };

export type EvalReport = {
  startedAt: string;
  finishedAt: string;
  projectId: string;
  checks: EvalCheck[];
  /** Requirements. These decide `ok`. */
  assertions: EvalTally;
  /** Model-graded scores. Recorded for comparison; they do not decide `ok`. */
  metrics: EvalTally;
  passed: number;
  failed: number;
  ok: boolean;
  suites: Record<EvalSuite, EvalTally>;
};

/** A pass/fail requirement. */
export function check(suite: EvalSuite, name: string, passed: boolean, detail: string): EvalCheck {
  return { suite, name, kind: "assertion", passed, detail };
}

/** A model-graded score. Recorded and shown; it cannot fail the run on its own. */
export function metric(suite: EvalSuite, name: string, passed: boolean, detail: string): EvalCheck {
  return { suite, name, kind: "metric", passed, detail };
}

export function buildReport(input: {
  projectId: string;
  checks: EvalCheck[];
  startedAt: Date;
  finishedAt: Date;
}): EvalReport {
  const suites = Object.fromEntries(
    EVAL_SUITES.map((suite) => [suite, { passed: 0, failed: 0 }]),
  ) as EvalReport["suites"];

  const assertions: EvalTally = { passed: 0, failed: 0 };
  const metrics: EvalTally = { passed: 0, failed: 0 };

  for (const entry of input.checks) {
    const tally = entry.kind === "metric" ? metrics : assertions;

    if (entry.passed) {
      tally.passed += 1;
      suites[entry.suite].passed += 1;
    } else {
      tally.failed += 1;
      suites[entry.suite].failed += 1;
    }
  }

  const passed = input.checks.filter((entry) => entry.passed).length;

  return {
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    projectId: input.projectId,
    checks: input.checks,
    assertions,
    metrics,
    passed,
    failed: input.checks.length - passed,
    // No assertions at all is a broken run, not a passing one.
    ok: assertions.passed + assertions.failed > 0 && assertions.failed === 0,
    suites,
  };
}

/** Human-readable report for the CLI. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  for (const suite of EVAL_SUITES) {
    const entries = report.checks.filter((entry) => entry.suite === suite);
    if (entries.length === 0) continue;

    const tally = report.suites[suite];
    lines.push(`\n${suite.toUpperCase()}  (${tally.passed} passed, ${tally.failed} failed)`);

    for (const entry of entries) {
      const label = entry.kind === "metric" ? "METRIC" : entry.passed ? "PASS" : "FAIL";
      lines.push(`  ${label.padEnd(6)} ${entry.name}`);
      lines.push(`         ${entry.detail}`);
    }
  }

  const metricNote =
    report.metrics.passed + report.metrics.failed > 0
      ? ` · ${report.metrics.passed + report.metrics.failed} metric(s) recorded, ${report.metrics.failed} below floor`
      : "";

  lines.push(
    `\n${report.ok ? "PASSED" : "FAILED"}: ${report.assertions.passed} assertion(s) passed, ` +
      `${report.assertions.failed} failed${metricNote} ` +
      `(${report.startedAt} → ${report.finishedAt})`,
  );

  return lines.join("\n");
}
