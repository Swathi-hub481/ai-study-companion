/**
 * Performance measurement harness.
 *
 * Drives the real services the routes call and records where the wall-clock time goes,
 * so a before/after comparison is measured rather than asserted. It runs against
 * whatever the environment is configured for — including the real generation provider —
 * because the dominant cost of the Tutor and of quiz generation is the model call, and
 * a harness that measured a mock would report a latency nobody experiences.
 *
 * Usage:
 *   npx tsx scripts/perf-baseline.ts <label>
 *
 * Writes `.perf/<label>.json` (override with PERF_OUT_DIR) and prints a table.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env", quiet: true });

type Stats = { count: number; median: number; mean: number; min: number; max: number };

const results = new Map<string, number[]>();
const breakdowns = new Map<string, string[]>();
const notes: string[] = [];

function record(name: string, ms: number): void {
  const samples = results.get(name) ?? [];
  samples.push(ms);
  results.set(name, samples);
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);

  return {
    count: sorted.length,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    mean: total / sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

const failures = new Map<string, string>();

async function measure(name: string, run: () => Promise<void>, iterations = 5): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    const startedAt = performance.now();

    try {
      await run();
      record(name, performance.now() - startedAt);
    } catch (error) {
      // A provider rate limit is a result too. Record why and move on, so one
      // throttled flow does not cost the numbers for every other flow.
      failures.set(name, error instanceof Error ? error.message.slice(0, 200) : String(error));
      break;
    }
  }
}

/** Waits for the provider's per-minute token budget to roll over. */
function cooldown(ms = 65_000): Promise<void> {
  console.log(`… waiting ${Math.round(ms / 1000)}s for the provider rate-limit window`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function line(prefix = ""): void {
  console.log(prefix + "-".repeat(78));
}

async function main(): Promise<void> {
  const label = process.argv[2] ?? "run";
  const outDir =
    process.env.PERF_OUT_DIR ?? join(process.env.COMMANDCODE_SCRATCHPAD ?? ".", "perf");

  const { prisma } = await import("../lib/db");
  const { Role, MaterialStatus, QuizMode, QuizStatus } = await import("@prisma/client");
  const { getHomeDashboard } = await import("../lib/services/home");
  const { listSpaces, getSpaceDashboard } = await import("../lib/services/spaces");
  const { getProjectDashboard } = await import("../lib/services/projects");
  const { listMaterials } = await import("../lib/services/materials");
  const { listQuizzes, startQuiz, submitAnswer, completeQuiz } =
    await import("../lib/services/quizzes");
  const { getProjectGrowth } = await import("../lib/services/growth");
  const { getProjectAnalytics, getGlobalAnalytics } = await import("../lib/services/analytics");
  const { getUserJourney, getSystemHealth, getAiUsage, listJobs, listActivity } =
    await import("../lib/services/admin");
  const { askTutor } = await import("../lib/services/tutor");
  const { retrieveEvidence } = await import("../lib/rag/retrieve");
  const { aiEmbed } = await import("../lib/ai");
  const { beginTiming, formatTimingReport } = await import("../lib/performance/timing");

  // ---- Fixtures -----------------------------------------------------------

  const project = await prisma.project.findFirst({
    where: {
      materials: { some: { status: MaterialStatus.READY } },
      concepts: { some: {} },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, spaceId: true, space: { select: { userId: true } } },
  });

  if (!project) {
    throw new Error(
      "No project with a READY material and concepts exists. Seed the database first.",
    );
  }

  const userId = project.space.userId;
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    select: { role: true },
  });

  if (!admin) throw new Error("No ADMIN user exists; admin flows cannot be measured.");

  const concept = await prisma.concept.findFirst({
    where: { projectId: project.id },
    orderBy: { importance: "desc" },
    select: { name: true },
  });

  const question = `Explain ${concept?.name ?? "the main ideas"} and why it matters.`;

  console.log(`\nPerf run "${label}"`);
  console.log(
    `provider=${process.env.AI_PROVIDER} embed=${process.env.AI_EMBED_PROVIDER} model=${process.env.AI_MODEL_TUTOR}`,
  );
  console.log(`project="${project.name}" (${project.id})`);
  console.log(`question="${question}"`);

  // ---- Warm-up ------------------------------------------------------------

  // The local embedding model loads once per process; charging that to the first
  // measured flow would misattribute a one-off cost to a per-request cost.
  const coldStart = performance.now();
  await aiEmbed({ context: { userId, projectId: project.id }, inputs: ["warm up the model"] });
  const coldMs = performance.now() - coldStart;
  notes.push(`embedding model first-load (cold): ${Math.round(coldMs)}ms`);

  // One throwaway retrieval so the SQL path is compiled before it is measured.
  await retrieveEvidence({ userId, projectId: project.id, query: question });

  // ---- Read-heavy flows ----------------------------------------------------

  await measure("home", async () => {
    await getHomeDashboard(userId);
  });

  await measure("spaces", async () => {
    await listSpaces(userId);
  });

  await measure("space_dashboard", async () => {
    await getSpaceDashboard(userId, project.spaceId);
  });

  await measure("project_dashboard", async () => {
    await getProjectDashboard(userId, project.id);
  });

  await measure("materials", async () => {
    await listMaterials(userId, project.id);
  });

  await measure("quiz_list", async () => {
    await listQuizzes(userId, project.id);
  });

  await measure("growth", async () => {
    await getProjectGrowth(userId, project.id);
  });

  await measure("project_analytics", async () => {
    await getProjectAnalytics(userId, project.id);
  });

  await measure(
    "admin_analytics",
    async () => {
      await getGlobalAnalytics(admin);
    },
    3,
  );

  await measure(
    "admin_journey",
    async () => {
      await getUserJourney(admin, userId);
    },
    3,
  );

  await measure(
    "admin_misc",
    async () => {
      await Promise.all([
        getSystemHealth(admin),
        getAiUsage(admin, { days: 30 }),
        listJobs(admin, {}),
        listActivity(admin, { page: 1, pageSize: 25 }),
      ]);
    },
    3,
  );

  // ---- Embedding + retrieval ----------------------------------------------

  // Same text every time: exercises the repeated-query path (a cache hit once memoised).
  await measure(
    "embed(same text)",
    async () => {
      await aiEmbed({ context: { userId, projectId: project.id }, inputs: [question] });
    },
    10,
  );

  // A distinct string each time, so every call reaches the model.
  let uniqueCounter = 0;
  await measure(
    "embed(unique text)",
    async () => {
      uniqueCounter += 1;
      await aiEmbed({
        context: { userId, projectId: project.id },
        inputs: [`${question} (variant ${uniqueCounter})`],
      });
    },
    10,
  );

  await measure(
    "retrieve",
    async () => {
      await retrieveEvidence({ userId, projectId: project.id, query: question });
    },
    10,
  );

  // ---- Tutor ---------------------------------------------------------------

  for (let i = 0; i < 2; i += 1) {
    const session = beginTiming(`tutor#${i + 1}`);
    const startedAt = performance.now();
    let firstDeltaAt: number | null = null;
    let characters = 0;

    try {
      for await (const event of askTutor(
        userId,
        { projectId: project.id, message: question },
        { timing: session },
      )) {
        if (event.type === "delta") {
          if (firstDeltaAt === null) firstDeltaAt = performance.now() - startedAt;
          characters += event.text.length;
        }
      }
    } catch (error) {
      failures.set("tutor", error instanceof Error ? error.message.slice(0, 200) : String(error));
      break;
    }

    record("tutor.first_token", firstDeltaAt ?? performance.now() - startedAt);
    record("tutor.complete", performance.now() - startedAt);

    const report = session.report();
    const formatted = formatTimingReport(report);
    breakdowns.set(`tutor#${i + 1}`, formatted.split("\n"));
    breakdowns.set(`tutor#${i + 1}-chars`, [`${characters} characters streamed`]);
  }

  // ---- Quiz generation -----------------------------------------------------

  // The provider's token budget is enforced per minute, and the Tutor turns above spend
  // most of a window. Waiting here means generation is measured against a fresh budget
  // rather than against the harness's own leftovers.
  await cooldown();

  const generated: Awaited<ReturnType<typeof startQuiz>>[] = [];

  for (let i = 0; i < 2; i += 1) {
    const startedAt = performance.now();

    try {
      const quiz = await startQuiz(userId, {
        projectId: project.id,
        mode: QuizMode.QUIZ,
        length: 3,
      });

      record("quiz_generation(3q)", performance.now() - startedAt);
      generated.push(quiz);
    } catch (error) {
      failures.set(
        "quiz_generation(3q)",
        error instanceof Error ? error.message.slice(0, 200) : String(error),
      );
      break;
    }

    // A fresh window before the second generation run.
    if (i === 0) await cooldown();
  }

  if (generated.length === 0) {
    notes.push("quiz flows skipped: no quiz could be generated (see failures).");
    console.log("\nNo quiz was generated; skipping answer flows.");
    console.log(`\nFailures:\n${[...failures].map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
    await prisma.$disconnect();
    return;
  }

  // ---- Answering -----------------------------------------------------------

  const mcqQuiz = generated[0]!;
  const mcqQuestion = mcqQuiz.questions.find((q) => q.type === "MULTIPLE_CHOICE");

  if (mcqQuestion) {
    await measure(
      "answer_mcq",
      async () => {
        await submitAnswer(userId, mcqQuiz.id, {
          questionId: mcqQuestion.id,
          answer: mcqQuestion.options[0]?.id ?? "",
        });
      },
      1,
    );
  } else {
    notes.push("answer_mcq skipped: the generated quiz had no multiple-choice question.");
  }

  const openQuestion = generated[1]?.questions.find((q) => q.type === "OPEN_ENDED");

  if (openQuestion) {
    const answer = `A short answer about ${concept?.name ?? "the topic"} written for grading measurement.`;

    // Two runs: the first is a cold-ish path, the second shows steady state.
    for (let i = 0; i < 2; i += 1) {
      const startedAt = performance.now();
      await submitAnswer(userId, generated[1]!.id, {
        questionId: openQuestion.id,
        answer,
      });
      record("answer_open_ended", performance.now() - startedAt);
      break; // A question can only be answered once; one measurement is all the data allows.
    }
  } else {
    notes.push("answer_open_ended skipped: the generated quiz had no open-ended question.");
  }

  // ---- Completion ----------------------------------------------------------

  const completable = await prisma.quiz.findFirst({
    where: { projectId: project.id, status: QuizStatus.IN_PROGRESS },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  if (completable) {
    await measure(
      "quiz_complete",
      async () => {
        await completeQuiz(userId, completable.id);
      },
      1,
    );
  }

  // ---- Report --------------------------------------------------------------

  const summary: Record<string, Stats> = {};

  console.log("");
  line();
  console.log(
    `${"flow".padEnd(26)}${"n".padStart(3)}${"median".padStart(10)}${"mean".padStart(10)}${"min".padStart(10)}${"max".padStart(10)}`,
  );
  line();

  for (const [name, samples] of results) {
    const value = stats(samples);
    summary[name] = value;

    console.log(
      name.padEnd(26) +
        String(value.count).padStart(3) +
        `${Math.round(value.median)}ms`.padStart(10) +
        `${Math.round(value.mean)}ms`.padStart(10) +
        `${Math.round(value.min)}ms`.padStart(10) +
        `${Math.round(value.max)}ms`.padStart(10),
    );
  }

  line();

  for (const note of notes) console.log(`note: ${note}`);

  for (const [name, message] of failures) {
    console.log(`FAILED ${name}: ${message}`);
  }

  for (const [name, lines] of breakdowns) {
    if (name.endsWith("-chars")) {
      console.log(`\n${lines[0]}`);
      continue;
    }

    console.log("");
    console.log(lines.join("\n"));
  }

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `${label}.json`);
  await writeFile(
    outFile,
    JSON.stringify(
      {
        label,
        at: new Date().toISOString(),
        summary,
        notes,
        failures: Object.fromEntries(failures),
        breakdowns: Object.fromEntries(breakdowns),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nWrote ${outFile}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
