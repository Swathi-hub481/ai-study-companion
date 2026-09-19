/**
 * Phase 8 acceptance harness.
 *
 * Reports what the growth pipeline actually concluded for a project: each concept's band
 * and delta, the recommendations generated from that state, the curated context that was
 * persisted, and the next action the dashboard would state.
 *
 * Usage: npx tsx scripts/diag-growth.ts "<project name>"
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

function oneLine(value: string, limit = 200): string {
  return value.replace(/\s+/g, " ").slice(0, limit);
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { getGrowthForProject } = await import("../lib/services/growth");
  const { generateForProject, listForProject } = await import("../lib/services/recommendations");
  const { rebuildLearningContext, getContextSlice } = await import("../lib/services/learning-context");
  const { getProjectDashboard } = await import("../lib/services/projects");
  const { drainQueue } = await import("../lib/jobs/worker");

  const projectName = process.argv[2];

  const project = await prisma.project.findFirst({
    where: projectName ? { name: { contains: projectName } } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, goal: true, space: { select: { userId: true } } },
  });

  if (!project) {
    console.log(`No project matching "${projectName}".`);
    return;
  }

  const userId = project.space.userId;
  console.log(`project: ${project.name} (${project.id})`);

  // Run anything the app queued (a completed quiz enqueues the whole chain).
  const drained = await drainQueue();
  console.log(`queue drained: processed=${drained.processed} completed=${drained.completed}\n`);

  console.log("=== growth ===");
  const growth = await getGrowthForProject(project.id);

  if (growth.length === 0) {
    console.log("no concepts in this project yet");
  }

  for (const concept of growth) {
    const delta = concept.delta === 0 ? "0" : `${concept.delta > 0 ? "+" : ""}${concept.delta.toFixed(3)}`;
    console.log(
      `  ${concept.band.padEnd(15)} mastery=${concept.mastery.toFixed(3)} delta=${delta.padStart(7)} observations=${concept.evidenceCount}  ${concept.name}`,
    );
  }

  const byBand = growth.reduce<Record<string, number>>((totals, concept) => {
    totals[concept.band] = (totals[concept.band] ?? 0) + 1;
    return totals;
  }, {});
  console.log(`  bands: ${JSON.stringify(byBand)}`);

  console.log("\n=== recommendations (regenerated) ===");
  const generated = await generateForProject(project.id);
  console.log(`generated ${generated.created} from ${generated.concepts} concepts`);

  for (const recommendation of await listForProject(project.id)) {
    if (recommendation.status !== "OPEN") continue;
    console.log(`\n  [priority ${recommendation.priority.toFixed(2)}] ${recommendation.title}`);
    console.log(`    ${oneLine(recommendation.body)}`);
    console.log(`    reason: ${oneLine(recommendation.reason ?? "—")}`);
    console.log(`    concept: ${recommendation.conceptName ?? "—"}`);
  }

  console.log("\n=== curated LearningContext ===");
  const rebuilt = await rebuildLearningContext(project.id);
  console.log(`  rebuilt: ${JSON.stringify(rebuilt)}`);

  const slice = await getContextSlice(project.id);
  console.log(`  goal: ${slice.goal ?? "—"}`);
  console.log(`  strengths: ${slice.strengths.join(", ") || "—"}`);
  console.log(`  weaknesses: ${slice.weaknesses.join(", ") || "—"}`);
  console.log(`  repeated mistakes: ${slice.repeatedMistakes.join(", ") || "—"}`);
  console.log(`  tutor summary: ${slice.tutorSummary ? oneLine(slice.tutorSummary) : "—"}`);

  console.log("\n=== dashboard next action ===");
  const dashboard = await getProjectDashboard(userId, project.id);
  console.log(`  source: ${dashboard.nextAction.source}`);
  console.log(`  title: ${dashboard.nextAction.title}`);
  console.log(`  body: ${oneLine(dashboard.nextAction.body)}`);
  console.log(`  basis: ${oneLine(dashboard.nextAction.basis)}`);
  console.log(`  open recommendations: ${dashboard.recommendations.filter((r) => r.status === "OPEN").length}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
