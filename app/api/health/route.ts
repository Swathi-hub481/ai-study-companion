import { checkDatabaseConnection } from "@/lib/db";
import { env } from "@/lib/config";
import { route } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Health and configuration smoke check.
 *
 * Reports which AI provider is active so a misconfigured deployment is obvious
 * without digging through logs. Secrets are never included.
 */
export async function GET() {
  return route(async () => {
    const databaseUp = await checkDatabaseConnection();

    const body = {
      data: {
        status: databaseUp ? "healthy" : "degraded",
        checks: {
          database: databaseUp ? "up" : "down",
        },
        config: {
          aiProvider: env.AI_PROVIDER,
          storageDriver: env.STORAGE_DRIVER,
          embeddingModel: env.AI_EMBED_MODEL,
          retrievalTopK: env.RETRIEVAL_TOP_K,
          ocrEnabled: env.OCR_ENABLED,
        },
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json(body, { status: databaseUp ? 200 : 503 });
  });
}
