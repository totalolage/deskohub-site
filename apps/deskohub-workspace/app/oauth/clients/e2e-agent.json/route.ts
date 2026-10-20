import { connection } from "next/server";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";

/**
 * The synthetic test agent's Client ID Metadata Document. It is served per
 * request and never cached, so every authorization that names the agent
 * fetches it again.
 */
export async function GET() {
  await connection();
  return Response.json(customerAgentTestClientMetadata, {
    headers: { "Cache-Control": "no-store" },
  });
}
