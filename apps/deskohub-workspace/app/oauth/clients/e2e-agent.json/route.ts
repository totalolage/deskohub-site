import { connection } from "next/server";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";

/**
 * The synthetic test agent's Client ID Metadata Document, served per
 * request. An OAuth server keeps it for at most a minute: long enough that
 * the lookups of one authorization reuse one fetch, which the metadata
 * fetch policy spaces at least a second apart, and short enough that each
 * E2E run fetches it again.
 */
export async function GET() {
  await connection();
  return Response.json(customerAgentTestClientMetadata, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
