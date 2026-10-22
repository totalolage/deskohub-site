import { after } from "next/server";
import type { AppRoutes } from "@/.next/types/routes";
import type { AgentTraffic } from "@/shared/agent-traffic/agent-traffic";
import { routeTemplateMatcher } from "@/shared/utils/route-template";

export interface AgentPageRequest {
  readonly traffic: AgentTraffic;
  readonly locale: string;
  /** The requested pathname, starting with the locale segment. */
  readonly pathname: string;
}

const localeRouteSegment = "/[locale]";

// Administration pages record no agent page request, and the not-found
// catch-all is reported as `unknown`.
type AgentPageRoute = Exclude<
  Extract<AppRoutes, `${typeof localeRouteSegment}${string}`>,
  | `${typeof localeRouteSegment}/[...not-found]`
  | `${typeof localeRouteSegment}/admin`
  | `${typeof localeRouteSegment}/admin/${string}`
>;

// Next generates `AppRoutes` from the app directory, so typecheck fails until
// a new page is listed here and once a listed page is gone.
const agentPageRoutes = {
  "/[locale]": true,
  "/[locale]/account": true,
  "/[locale]/account/[section]": true,
  "/[locale]/account/deleted": true,
  "/[locale]/account/legal": true,
  "/[locale]/ai-assistants": true,
  "/[locale]/auth/callback": true,
  "/[locale]/auth/connect": true,
  "/[locale]/auth/consent": true,
  "/[locale]/auth/sign-in": true,
  "/[locale]/auth/verify": true,
  "/[locale]/checkout-status-preview": true,
  "/[locale]/checkout/pay": true,
  "/[locale]/contact": true,
  "/[locale]/cookie-policy": true,
  "/[locale]/cookie-settings": true,
  "/[locale]/dotypos-tables": true,
  "/[locale]/email-preview/contact-business": true,
  "/[locale]/email-preview/contact-confirmation": true,
  "/[locale]/email-preview/customer-reservation": true,
  "/[locale]/email-preview/reservation-author": true,
  "/[locale]/email-preview/reservation-notification": true,
  "/[locale]/faq": true,
  "/[locale]/gallery": true,
  "/[locale]/logo": true,
  "/[locale]/map-preview": true,
  "/[locale]/marketing-communications": true,
  "/[locale]/meeting-room": true,
  "/[locale]/operating-rules": true,
  "/[locale]/post-order-invoice-preview": true,
  "/[locale]/pricing": true,
  "/[locale]/privacy-policy": true,
  "/[locale]/reservation-access-preview": true,
  "/[locale]/reservation/access/[orderId]": true,
  "/[locale]/reservation/cowork": true,
  "/[locale]/reservation/invoice/[orderId]": true,
  "/[locale]/reservation/meeting-room": true,
  "/[locale]/reservation/office": true,
  "/[locale]/reservation/payment-disabled/[orderId]": true,
  "/[locale]/reservation/status/[orderId]": true,
  "/[locale]/route-error-preview": true,
  "/[locale]/team": true,
  "/[locale]/terms-and-conditions": true,
  "/[locale]/ttrpg-room": true,
} as const satisfies Record<AgentPageRoute, true>;

const matchAgentPageRoute = routeTemplateMatcher(
  Object.keys(agentPageRoutes) as AgentPageRoute[]
);

/**
 * The route template of the page a request asked for, without its locale
 * segment, such as `/reservation/status/[orderId]`. A path no page matches,
 * extra segments included, is `unknown`, so no requested value is recorded.
 */
export const agentPageRoute = (pathname: string) => {
  const template = matchAgentPageRoute(pathname);
  if (template === undefined) return "unknown";
  return template.slice(localeRouteSegment.length) || "/";
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
      properties: { route: agentPageRoute(pathname), locale },
      timestamp,
    });
  });
};
