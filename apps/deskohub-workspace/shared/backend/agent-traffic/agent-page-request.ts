import { after } from "next/server";
import type { AgentTraffic } from "@/shared/agent-traffic/agent-traffic";
import { sanitizeAnalyticsPathname } from "@/shared/utils/analytics-url";

export interface AgentPageRequest {
  readonly traffic: AgentTraffic;
  readonly locale: string;
  /** The requested pathname, starting with the locale segment. */
  readonly pathname: string;
}

/**
 * The page a request rendered, without its locale segment or operational
 * identifiers, such as `/reservation/status/[id]`.
 */
export const agentPageRoute = (pathname: string, locale: string) => {
  const localePrefix = `/${locale}`;
  const unlocalized = pathname.startsWith(localePrefix)
    ? pathname.slice(localePrefix.length)
    : pathname;
  return sanitizeAnalyticsPathname(
    unlocalized.startsWith("/") ? unlocalized : `/${unlocalized}`
  );
};

/**
 * Records an agent's page request after the proxy's response is sent. The
 * event's capture code and runtime load only then, and only for agent
 * traffic; a failure never reaches the page request.
 */
export const scheduleAgentPageRequest = ({
  traffic,
  locale,
  pathname,
}: AgentPageRequest) => {
  const timestamp = Temporal.Now.instant();
  after(async () => {
    const { recordAgentTrafficEvent } = await import("./agent-traffic-events");
    await recordAgentTrafficEvent({
      event: "agent page request",
      traffic,
      properties: { route: agentPageRoute(pathname, locale), locale },
      timestamp,
    });
  });
};
