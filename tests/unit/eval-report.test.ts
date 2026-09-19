import { describe, expect, it } from "vitest";
import { buildReport, check, formatReport, metric, type EvalCheck } from "@/lib/eval/report";

const startedAt = new Date("2026-02-15T10:00:00Z");
const finishedAt = new Date("2026-02-15T10:01:00Z");

function report(checks: EvalCheck[]) {
  return buildReport({ projectId: "project-1", checks, startedAt, finishedAt });
}

describe("buildReport", () => {
  it("is ok only when every check passes", () => {
    const result = report([
      check("tutor", "cites material", true, "2 citations"),
      check("retrieval", "ranks first", true, "score 0.9"),
    ]);

    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("is not ok when a single check fails", () => {
    const result = report([
      check("tutor", "cites material", true, "2 citations"),
      check("assessment", "answer key valid", false, "key was not among the options"),
    ]);

    expect(result.failed).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("treats a run with no checks as a failure, not a pass", () => {
    // A harness that silently ran nothing must not look like a green run.
    const result = report([]);

    expect(result.ok).toBe(false);
    expect(result.passed).toBe(0);
  });

  it("tallies per suite, including suites with no checks", () => {
    const result = report([
      check("tutor", "a", true, ""),
      check("tutor", "b", false, ""),
      check("recommendations", "c", true, ""),
    ]);

    expect(result.suites.tutor).toEqual({ passed: 1, failed: 1 });
    expect(result.suites.recommendations).toEqual({ passed: 1, failed: 0 });
    expect(result.suites.retrieval).toEqual({ passed: 0, failed: 0 });
  });

  it("records the window it ran over", () => {
    const result = report([check("tutor", "a", true, "")]);

    expect(result.startedAt).toBe(startedAt.toISOString());
    expect(result.finishedAt).toBe(finishedAt.toISOString());
    expect(result.projectId).toBe("project-1");
  });

  it("does not fail the run for a metric below its floor", () => {
    // The same model grading the same fixture scored one criterion 0.30, 0.85 and 1.00
    // across three runs. A noisy number must not be able to turn the harness red.
    const result = report([
      check("tutor", "cites material", true, "2 citations"),
      metric("tutor", "grounded (model-graded)", false, "score=0.40"),
    ]);

    expect(result.ok).toBe(true);
    expect(result.assertions).toEqual({ passed: 1, failed: 0 });
    expect(result.metrics).toEqual({ passed: 0, failed: 1 });
  });

  it("still fails the run when an assertion fails alongside a metric", () => {
    const result = report([
      check("assessment", "answer key valid", false, "key was not among the options"),
      metric("assessment", "question quality", true, "score=0.9"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.assertions.failed).toBe(1);
  });

  it("does not let metrics alone make a run pass", () => {
    // Metrics are extra evidence, not a substitute for requirements.
    const result = report([metric("tutor", "grounded", true, "score=1.0")]);

    expect(result.ok).toBe(false);
  });

  it("tallies metrics per suite alongside assertions", () => {
    const result = report([
      check("tutor", "a", true, ""),
      metric("tutor", "b", false, ""),
    ]);

    expect(result.suites.tutor).toEqual({ passed: 1, failed: 1 });
  });
});

describe("formatReport", () => {
  it("lists each check with its evidence and a verdict", () => {
    const text = formatReport(
      report([
        check("tutor", "cites the project's material", true, "2 citations"),
        check("retrieval", "no cross-project hits", false, "3 chunks leaked"),
      ]),
    );

    expect(text).toContain("TUTOR");
    expect(text).toMatch(/PASS\s+cites the project's material/);
    expect(text).toContain("2 citations");
    expect(text).toMatch(/FAIL\s+no cross-project hits/);
    expect(text).toContain("3 chunks leaked");
    expect(text).toContain("FAILED: 1 assertion(s) passed, 1 failed");
  });

  it("says PASSED when everything passed", () => {
    const text = formatReport(report([check("assessment", "a", true, "ok")]));

    expect(text).toContain("PASSED: 1 assertion(s) passed, 0 failed");
  });

  it("labels model-graded checks as metrics and counts them in the footer", () => {
    const text = formatReport(
      report([
        check("tutor", "cites material", true, "2 citations"),
        metric("tutor", "grounded", false, "score=0.40"),
      ]),
    );

    expect(text).toContain("METRIC grounded");
    expect(text).toContain("1 metric(s) recorded, 1 below floor");
    // The run itself still passed, because the requirement held.
    expect(text).toContain("PASSED:");
  });
});
