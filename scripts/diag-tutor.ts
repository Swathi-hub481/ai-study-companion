/**
 * Phase 6 acceptance harness.
 *
 * Drives the real Tutor service against a project — the same generator `POST /api/tutor`
 * serialises as SSE — so retrieval, the evidence gate, citations and persistence can be
 * checked end to end without a browser.
 *
 * Usage: npx tsx scripts/diag-tutor.ts "<project name>" "<question>"
 */

import { config } from "dotenv";

config({ path: ".env", quiet: true });

async function main() {
  const { prisma } = await import("../lib/db");
  const { askTutor } = await import("../lib/services/tutor");

  const projectName = process.argv[2];
  const question = process.argv[3] ?? "What projects are mentioned in my uploaded resume?";

  const project = await prisma.project.findFirst({
    where: projectName ? { name: { contains: projectName } } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, space: { select: { userId: true } } },
  });

  if (!project) {
    console.log(`No project matching "${projectName}".`);
    return;
  }

  const userId = project.space.userId;

  console.log(`project : ${project.name} (${project.id})`);
  console.log(`question: ${question}\n`);

  let answer = "";
  const order: string[] = [];

  for await (const event of askTutor(userId, { projectId: project.id, message: question })) {
    order.push(event.type);

    if (event.type === "citations") {
      console.log(`CITATIONS (${event.citations.length}):`);
      for (const citation of event.citations) {
        console.log(`  - "${citation.title}" p.${citation.page} score=${citation.score}`);
      }
    }

    if (event.type === "delta") answer += event.text;

    if (event.type === "insufficient_evidence") {
      console.log(`REFUSED: ${event.message}`);
    }

    if (event.type === "done") {
      console.log(`DONE    conversation=${event.conversationId} message=${event.messageId}`);
    }
  }

  if (answer) console.log(`\nANSWER:\n${answer}`);
  console.log(`\nevent order: ${order.join(" -> ")}`);

  const message = await prisma.message.findFirst({
    where: { conversation: { projectId: project.id } },
    orderBy: { createdAt: "desc" },
  });

  const citationCount = Array.isArray(message?.citations)
    ? (message.citations as unknown[]).length
    : 0;

  console.log(
    `persisted last message: role=${message?.role} citations=${citationCount} chars=${message?.content.length ?? 0}`,
  );

  const requests = await prisma.aiRequest.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { feature: true, provider: true, model: true, status: true, latencyMs: true },
  });

  console.log(`recent AiRequest: ${JSON.stringify(requests)}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
