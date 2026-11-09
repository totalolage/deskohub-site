import { env } from "@/env";

/**
 * The ChatGPT app directory's domain verification file: exactly the token
 * from the app submission, as plain text. Only production has a token, so
 * other deployments answer not found.
 */
export function serveOpenAiAppsChallenge() {
  const token = env.OPENAI_APPS_CHALLENGE_TOKEN;
  if (token === undefined) return new Response(null, { status: 404 });

  return new Response(token, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
