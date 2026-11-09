"use client";

import { Bot, Check, ShieldAlert, Unplug } from "lucide-react";
import { useState } from "react";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { disconnectCustomerAgent } from "@/features/account/customer-agent-connection-client";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import { describeCustomerAgentScope } from "@/features/account/customer-agent-scope-copy";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { workspaceSiteConstants } from "@/shared/utils";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { DisconnectCustomerAgentDialog } from "./disconnect-customer-agent-dialog";

type CustomerAgentConnectionsSectionProps = {
  readonly locale: Locale;
  /** Null when the list couldn't be read. */
  readonly connections: readonly CustomerAgentConnection[] | null;
  /** Whether another account section is active. */
  readonly hidden: boolean;
};

/**
 * The AI assistants the customer let use their account, each with what it
 * may do and a way to disconnect it. It needs only the session, so it works
 * without a Dotypos profile.
 */
export function CustomerAgentConnectionsSection({
  locale,
  connections: initialConnections,
  hidden,
}: CustomerAgentConnectionsSectionProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [disconnecting, setDisconnecting] = useState<{
    readonly id: string;
    readonly name: string;
  } | null>(null);
  const [disconnected, setDisconnected] = useState(false);

  const disconnectConnection = async (id: string) => {
    setDisconnected(false);
    const result = await disconnectCustomerAgent(id);
    if (result === "disconnected") {
      setConnections(
        (current) =>
          current?.filter((connection) => connection.id !== id) ?? null
      );
    }
    return result;
  };

  return (
    <div hidden={hidden}>
      <AccountSectionPanel
        title={m.accountSectionAssistants({}, { locale })}
        titleId="account-assistants-title"
      >
        <p className="text-sm leading-6 text-navy-blue/68">
          {m.accountAssistantsIntro({}, { locale })}
        </p>

        {connections === null && (
          <p
            className="mt-5 rounded-xl border border-[#dfe4ec] px-4 py-5 text-sm leading-6 text-navy-blue/68"
            id="account-assistants-unavailable"
          >
            {m.accountAssistantsUnavailable({}, { locale })}
          </p>
        )}
        {connections !== null && connections.length > 0 && (
          <ul
            aria-labelledby="account-assistants-title"
            className="mt-5 divide-y divide-[#e6ebf1] rounded-xl border border-[#dfe4ec]"
          >
            {connections.map((connection) => {
              const name =
                connection.name ?? m.accountAssistantUnnamed({}, { locale });
              const date = formatInstantDate({
                instant: Temporal.Instant.from(connection.connectedAt),
                locale,
                timeZone: workspaceSiteConstants.location.timeZone,
              });
              return (
                <li
                  className="flex min-w-0 items-start gap-2 py-3 pr-2 pl-4 @xl:gap-4 @xl:p-4"
                  data-assistant-connection-id={connection.id}
                  key={connection.id}
                >
                  <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-[#f4f3ef] text-navy-blue @xl:flex">
                    <Bot aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-navy-blue">
                      {name}
                    </p>
                    <p className="mt-0.5 break-words text-sm text-navy-blue/60">
                      {connection.host === undefined
                        ? m.accountAssistantConnectedOn({ date }, { locale })
                        : m.accountAssistantDetails(
                            { host: connection.host, date },
                            { locale }
                          )}
                    </p>
                    {(connection.scopes.length > 0 ||
                      connection.administration) && (
                      <ul
                        aria-label={m.accountAssistantScopesLabel(
                          { name },
                          { locale }
                        )}
                        className="mt-2 space-y-1 text-sm leading-6 text-navy-blue/78"
                      >
                        {connection.scopes.map((scope) => (
                          <li
                            className="flex gap-2"
                            data-assistant-scope={scope}
                            key={scope}
                          >
                            <Check
                              aria-hidden
                              className="mt-1 size-4 shrink-0 text-emerald-600"
                            />
                            {describeCustomerAgentScope(scope, locale)}
                          </li>
                        ))}
                        {connection.administration && (
                          <li
                            className="flex gap-2"
                            data-assistant-scope="administration"
                          >
                            <ShieldAlert
                              aria-hidden
                              className="mt-1 size-4 shrink-0 text-burned-orange"
                            />
                            {m.customerAgentConsentAdministrationTitle(
                              {},
                              { locale }
                            )}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  <Button
                    aria-label={m.accountAssistantDisconnectLabel(
                      { name },
                      { locale }
                    )}
                    className="shrink-0"
                    onClick={() =>
                      setDisconnecting({ id: connection.id, name })
                    }
                    shape="rounded"
                    size="sm"
                    tone="danger"
                    type="button"
                    variant="ghost"
                  >
                    <Unplug aria-hidden className="size-4" />
                    <span className="hidden @xl:inline">
                      {m.accountAssistantDisconnect({}, { locale })}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {connections?.length === 0 && (
          <div
            className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-[#cfd6e0] bg-[#fbfcfd] px-6 py-8 text-center"
            id="account-assistants-empty"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-burned-orange shadow-[0_12px_28px_-18px_rgba(0,2,79,0.45)]">
              <Bot aria-hidden className="size-6" />
            </span>
            <p className="mt-4 font-semibold text-navy-blue">
              {m.accountAssistantsEmptyTitle({}, { locale })}
            </p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-navy-blue/68">
              {m.accountAssistantsEmptyBody({}, { locale })}
            </p>
          </div>
        )}

        <div
          aria-live="polite"
          className="mt-3 text-sm text-navy-blue/78 empty:mt-0"
          id="account-assistants-status"
        >
          {disconnected && m.accountAssistantDisconnected({}, { locale })}
        </div>

        <DisconnectCustomerAgentDialog
          connection={disconnecting}
          disconnect={disconnectConnection}
          locale={locale}
          onClose={() => setDisconnecting(null)}
          onDisconnected={() => {
            setDisconnecting(null);
            setDisconnected(true);
          }}
        />
      </AccountSectionPanel>
    </div>
  );
}
