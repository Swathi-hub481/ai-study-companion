/**
 * Phase 9 acceptance harness.
 *
 * Prints what an administrator sees: instance-wide analytics, system health, the latest
 * evaluation run, and — when a project is named — that project's own analytics.
 *
 * Usage: npx tsx scripts/diag-analytics.ts ["project name"]
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

function oneLine(value: string | null, limit = 160): string {
  return value ? value.replace(/\s+/g, " ").slice(0, limit) : "—";
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { getGlobalAnalytics, getProjectAnalytics } = await import("../lib/services/analytics");
  const { getAiUsage, getLatestEvaluation, getSystemHealth } = await import("../lib/services/admin");

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true, role: true },
  });

  if (!admin) {
    console.log("No ADMIN user exists — run `npm run db:seed` first.");
    return;
  }

  console.log(`acting as ${admin.email}\n`);

  const analytics = await getGlobalAnalytics(admin);
  console.log("=== global totals ===");
  for (const [key, value] of Object.entries(analytics.totals)) {
    console.log(`  ${key.padEnd(18)} ${value}`);
  }
  console.log(`  ${"average mastery".padEnd(18)} ${analytics.mastery.average.toFixed(3)}`);
  console.log(`  ${"activity (30d)".padEnd(18)} ${analytics.activityTotal}`);
  console.log(`  ${"top activity".padEnd(18)} ${analytics.activityByType.slice(0, 3).map((entry) => `${entry.type}=${entry.count}`).join(", ") || "—"}`);

  console.log("\n=== AI usage ===");
  console.log(
    `  calls=${analytics.ai.calls} failures=${analytics.ai.failures} tokens=${analytics.ai.promptTokens + analytics.ai.completionTokens} avgLatency=${analytics.ai.averageLatencyMs}ms cost=$${analytics.ai.costUsd}`,
  );
  for (const entry of analytics.ai.byFeature.slice(0, 8)) {
    console.log(`    ${entry.feature.padEnd(16)} calls=${entry.calls} failures=${entry.failures} avg=${entry.averageLatencyMs}ms`);
  }
  console.log(`    providers: ${analytics.ai.byProvider.map((entry) => `${entry.provider}=${entry.calls}`).join(", ") || "—"}`);

  console.log("\n=== jobs ===");
  console.log(`  ${JSON.stringify(analytics.jobs)}`);

  const health = await getSystemHealth(admin);
  console.log("\n=== system health ===");
  console.log(`  database=${health.database ? "up" : "down"} staleRunning=${health.staleRunning} oldestPending=${oneLine(health.oldestPendingAt)}`);
  console.log(`  provider=${health.config.aiProvider} embeddings=${health.config.aiEmbedProvider} (${health.config.embedModel}, ${health.config.embedDimensions}d)`);
  console.log(`  storage=${health.config.storageDriver} ocr=${health.config.ocrEnabled} retrievalMinScore=${health.config.retrievalMinScore}`);
  console.log(`  uptime=${health.process.uptimeSeconds}s rss=${health.process.rssMb}MB`);

  const usage = await getAiUsage(admin, { days: 30 });
  console.log(`\n=== AI usage (30d) ===`);
  console.log(`  calls=${usage.totals.calls} failures=${usage.totals.failures} avgLatency=${usage.totals.averageLatencyMs}ms cost=$${usage.totals.costUsd}`);
  console.log(`  by model: ${usage.byModel.map((entry) => `${entry.model}=${entry.calls}`).join(", ") || "—"}`);
  console.log(`  recent failures: ${usage.recentFailures.length}`);
  for (const failure of usage.recentFailures.slice(0, 3)) {
    console.log(`    ${failure.feature} ${failure.model}: ${oneLine(failure.error)}`);
  }

  const evaluation = await getLatestEvaluation(admin);
  console.log("\n=== latest evaluation ===");
  if (!evaluation) {
    console.log("  none — run `npm run eval`");
  } else {
    console.log(
      `  ${evaluation.report.ok ? "PASSED" : "FAILED"} ${evaluation.report.passed} passed / ${evaluation.report.failed} failed at ${evaluation.completedAt}`,
    );
    console.log(`  suites: ${JSON.stringify(evaluation.report.suites)}`);
  }

  const projectName = process.argv[2];

  if (projectName) {
    const project = await prisma.project.findFirst({
      where: { name: { contains: projectName } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, space: { select: { userId: true } } },
    });

    if (!project) {
      console.log(`\nNo project matching "${projectName}".`);
      return;
    }

    console.log(`\n=== project analytics: ${project.name} ===`);
    const projectAnalytics = await getProjectAnalytics(project.space.userId, project.id);
    console.log(`  activity (30d)=${projectAnalytics.activityTotal}`);
    console.log(`  activity by type: ${projectAnalytics.activityByType.slice(0, 5).map((entry) => `${entry.type}=${entry.count}`).join(", ") || "—"}`);
    console.log(
      `  assessments: started=${projectAnalytics.assessment.quizzesStarted} completed=${projectAnalytics.assessment.quizzesCompleted} graded=${projectAnalytics.assessment.answersGraded} average=${projectAnalytics.assessment.averageScore?.toFixed(3) ?? "—"}`,
    );
    console.log(`  mastery average=${projectAnalytics.mastery.average.toFixed(3)} over ${projectAnalytics.mastery.concepts.length} concepts`);
    console.log(`  materials: total=${projectAnalytics.materials.total} ready=${projectAnalytics.materials.ready} failed=${projectAnalytics.materials.failed}`);
    console.log(
      `  ai: calls=${projectAnalytics.ai.calls} failures=${projectAnalytics.ai.failures} avgLatency=${projectAnalytics.ai.averageLatencyMs}ms cost=$${projectAnalytics.ai.costUsd}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
