import { connection } from "next/server";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";

/**
 * The synthetic test agent's Client ID Metadata Document, served per
 * request. An OAuth server revalidates it after at most a minute; caching
 * it that long lets the lookups of one authorization reuse one fetch, which
 * the metadata fetch policy spaces at least a second apart.
 */
export async function GET() {
  await connection();
  return Response.json(customerAgentTestClientMetadata, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
