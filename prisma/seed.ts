import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

/**
 * Seed data.
 *
 * Creates one administrator and one learner, with a Space and Project for the
 * learner so the app is immediately explorable after `npm run db:seed`.
 *
 * Idempotent: safe to run repeatedly.
 */

const prisma = new PrismaClient();

/**
 * Refuses to create a known-password administrator in production.
 *
 * The seed exists to make a fresh checkout explorable, and it creates an admin whose
 * password is documented in the README. Run against a deployed database with those
 * defaults, it would hand anyone who read the repository an administrator account.
 */
function assertSafeToSeed(): void {
  if (process.env.NODE_ENV !== "production") return;

  const hasExplicitPasswords =
    Boolean(process.env.SEED_ADMIN_PASSWORD) && Boolean(process.env.SEED_USER_PASSWORD);

  if (hasExplicitPasswords || process.env.SEED_ALLOW_DEFAULT_PASSWORDS === "true") return;

  throw new Error(
    "Refusing to seed in production with the documented default passwords.\n" +
      "  Either set SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD to real values,\n" +
      "  or set SEED_ALLOW_DEFAULT_PASSWORDS=true if this database is not public.\n" +
      "  (If you are running locally, an exported NODE_ENV=production is the cause — unset it.)",
  );
}

async function main() {
  assertSafeToSeed();

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const userEmail = process.env.SEED_USER_EMAIL ?? "learner@example.com";
  const userPassword = process.env.SEED_USER_PASSWORD ?? "learner12345";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: Role.ADMIN },
    create: {
      email: adminEmail,
      name: "Platform Admin",
      role: Role.ADMIN,
      passwordHash: await hashPassword(adminPassword),
    },
  });

  const learner = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      name: "Demo Learner",
      role: Role.USER,
      passwordHash: await hashPassword(userPassword),
    },
  });

  const existingSpace = await prisma.space.findFirst({
    where: { userId: learner.id, name: "Machine Learning Foundations" },
  });

  const space =
    existingSpace ??
    (await prisma.space.create({
      data: {
        userId: learner.id,
        name: "Machine Learning Foundations",
        description:
          "Core concepts behind modern machine learning — from linear models to evaluation.",
        color: "#6366f1",
        icon: "brain",
      },
    }));

  const existingProject = await prisma.project.findFirst({
    where: { spaceId: space.id, name: "Supervised Learning Deep Dive" },
  });

  const project =
    existingProject ??
    (await prisma.project.create({
      data: {
        spaceId: space.id,
        name: "Supervised Learning Deep Dive",
        description:
          "Work through supervised learning techniques and be able to choose and justify a model for a given problem.",
        goal: "Be able to explain, compare, and apply supervised learning algorithms to a real dataset.",
      },
    }));

  if (!existingProject) {
    await prisma.learningContext.create({
      data: { projectId: project.id },
    });
  }

  console.log("Seed complete:");
  console.log(`  admin   ${admin.email}`);
  console.log(`  learner ${learner.email}`);
  console.log(`  space   ${space.name}`);
  console.log(`  project ${project.name}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
