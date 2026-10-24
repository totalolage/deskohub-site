import type {
  AdministrationCampaignContent,
  AutomationDryRun,
  AutomationDryRunRow,
  AutomationFlow,
  AutomationPreviewOutcome,
} from "@deskohub/workspace-admin-api";
import { automationPreviewOutcomes } from "@deskohub/workspace-admin-api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdministrationLink } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { formatCount } from "@/shared/utils/number";
import { SentCampaignEmailPreview } from "../../sending/sent-campaign-email-preview";
import { AutomationFrequencyBanner } from "../automation-frequency-banner";
import { automationStepLabelOrId } from "../run-log/automation-step-label";

const outcomeCopy = {
  "would-send": {
    tone: "positive",
    label: m.emailAutomationActivationOutcomeWouldSend,
  },
  "condition-failed": {
    tone: "neutral",
    label: m.emailAutomationActivationOutcomeConditionFailed,
  },
  "not-in-audience": {
    tone: "neutral",
    label: m.emailAutomationActivationOutcomeNotInAudience,
  },
  "already-active": {
    tone: "neutral",
    label: m.emailAutomationActivationOutcomeAlreadyActive,
  },
  withdrawn: {
    tone: "neutral",
    label: m.emailAutomationActivationOutcomeWithdrawn,
  },
  unavailable: {
    tone: "attention",
    label: m.emailAutomationActivationOutcomeUnavailable,
  },
} as const satisfies Record<
  AutomationPreviewOutcome,
  {
    readonly tone: StatusTone;
    readonly label: typeof m.emailAutomationActivationOutcomeWouldSend;
  }
>;

/**
 * What a dry run found: counts by outcome, the replayed events or the next
 * fire's entrants with their flags, and the rendered email per locale.
 * Everything is formatted here on the server, in Prague time.
 */
/** Why a page of the dry run has no rows: past the end, or none at all. */
const noRowsLabel = ({
  cursor,
  replay,
  locale,
}: {
  readonly cursor: string | undefined;
  readonly replay: boolean;
  readonly locale: Locale;
}) => {
  if (cursor) return m.emailAutomationActivationNoMoreRows({}, { locale });
  return replay
    ? m.emailAutomationActivationNoReplayRows({}, { locale })
    : m.emailAutomationActivationNoEntrants({}, { locale });
};

export function AutomationDryRunResults({
  content,
  cursor,
  dryRun,
  flow,
  locale,
}: {
  readonly content: AdministrationCampaignContent;
  readonly cursor: string | undefined;
  readonly dryRun: AutomationDryRun;
  /** The working copy the dry run evaluated, which names its steps. */
  readonly flow: AutomationFlow | null;
  readonly locale: Locale;
}) {
  const replay = dryRun.kind === "replay";
  const pageHref = (pageCursor?: string) =>
    `/admin/email-campaigns/${dryRun.campaignId}/preview?${new URLSearchParams({
      preview: dryRun.previewId,
      ...(pageCursor && { cursor: pageCursor }),
    })}`;
  return (
    <div className="space-y-6">
      <AdministrationDetailSection
        title={m.emailAutomationActivationResultsTitle({}, { locale })}
      >
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {automationPreviewOutcomes.map((outcome) => (
              <AdministrationFact
                key={outcome}
                label={outcomeCopy[outcome].label({}, { locale })}
                value={formatCount(dryRun.counts[outcome], locale)}
                valueClassName="text-2xl"
              />
            ))}
          </dl>
          {replay ? (
            <div className="space-y-2 text-navy-blue/70 text-sm leading-6">
              <p>
                {m.emailAutomationActivationReplayScope(
                  { asOf: formatAdministrationDateTime(dryRun.asOf, locale) },
                  { locale }
                )}
              </p>
              {dryRun.profileFactsAreCurrent && (
                <p>
                  {m.emailAutomationActivationProfileFactsCurrent(
                    {},
                    { locale }
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {dryRun.frequency && (
                <AutomationFrequencyBanner
                  frequency={dryRun.frequency}
                  locale={locale}
                />
              )}
              <div>
                <h3 className="font-semibold text-sm">
                  {m.emailAutomationActivationNextFiresTitle({}, { locale })}
                </h3>
                <ol className="mt-2 flex flex-wrap gap-2">
                  {dryRun.nextFires.map((fire, index) => (
                    <li key={fire}>
                      <Badge variant={index === 0 ? "emphasis" : "subtle"}>
                        {formatAdministrationDateTime(fire, locale)}
                      </Badge>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-navy-blue/60 text-xs">
                  {m.emailAutomationActivationPragueTime({}, { locale })}
                </p>
              </div>
            </div>
          )}
          {dryRun.truncated && dryRun.eventsTotal !== null && (
            <AdministrationAlert status="warning">
              {m.emailAutomationActivationTruncated(
                { total: formatCount(dryRun.eventsTotal, locale) },
                { locale }
              )}
            </AdministrationAlert>
          )}
        </div>
      </AdministrationDetailSection>

      <AdministrationDetailSection
        title={
          replay
            ? m.emailAutomationActivationReplayRowsTitle({}, { locale })
            : m.emailAutomationActivationEntrantsTitle(
                {
                  fire: formatAdministrationDateTime(dryRun.asOf, locale),
                },
                { locale }
              )
        }
      >
        {dryRun.rows.length === 0 ? (
          <p className="text-navy-blue/65 text-sm">
            {noRowsLabel({ cursor, replay, locale })}
          </p>
        ) : (
          <TooltipProvider>
            <DryRunRows
              dryRun={dryRun}
              flow={flow}
              locale={locale}
              replay={replay}
            />
          </TooltipProvider>
        )}
        {(cursor || dryRun.nextCursor) && (
          <nav
            aria-label={m.emailAutomationActivationPagesLabel({}, { locale })}
            className="mt-4 flex flex-wrap justify-between gap-2"
          >
            {cursor ? (
              <Button asChild size="sm" variant="secondary">
                <AdministrationLink href={pageHref()}>
                  <ChevronLeft aria-hidden className="size-4" />
                  {m.emailAutomationActivationFirstPage({}, { locale })}
                </AdministrationLink>
              </Button>
            ) : (
              <span />
            )}
            {dryRun.nextCursor && (
              <Button asChild size="sm" variant="secondary">
                <AdministrationLink href={pageHref(dryRun.nextCursor)}>
                  {m.emailAutomationActivationNextPage({}, { locale })}
                  <ChevronRight aria-hidden className="size-4" />
                </AdministrationLink>
              </Button>
            )}
          </nav>
        )}
      </AdministrationDetailSection>

      {dryRun.emails.length > 0 && (
        <AdministrationDetailSection
          title={m.emailAutomationActivationEmailTitle({}, { locale })}
        >
          <SentCampaignEmailPreview
            emails={dryRun.emails.map((email) => ({
              locale: email.locale,
              subject: email.subject,
              preheader: content[email.locale]?.preheader ?? "",
              html: email.html,
            }))}
          />
        </AdministrationDetailSection>
      )}
    </div>
  );
}

function DryRunRows({
  dryRun,
  flow,
  locale,
  replay,
}: {
  readonly dryRun: AutomationDryRun;
  readonly flow: AutomationFlow | null;
  readonly locale: Locale;
  readonly replay: boolean;
}) {
  const customers = new Map(
    dryRun.customers.map((customer) => [customer.customerId, customer])
  );
  const rows = dryRun.rows.map((row) => {
    const customer = customers.get(row.customerId);
    return {
      key: `${row.triggerAt}:${row.customerId}:${row.customerEventId ?? ""}`,
      row,
      name: customer?.name ?? customer?.email ?? row.customerId,
      detail: customer?.name ? customer.email : null,
      triggeredAt: formatAdministrationDateTime(row.triggerAt, locale),
      sendAt: row.sendAt && formatAdministrationDateTime(row.sendAt, locale),
    };
  });
  return (
    <>
      <ul
        aria-label={m.emailAutomationActivationRowsLabel({}, { locale })}
        className="divide-y divide-navy-blue/10 sm:hidden"
      >
        {rows.map(({ key, row, name, detail, triggeredAt, sendAt }) => (
          <li className="space-y-1.5 py-3 text-sm" key={key}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CustomerCell detail={detail} name={name} />
              <OutcomeCell flow={flow} locale={locale} row={row} />
            </div>
            {replay && (
              <p className="text-navy-blue/65">
                {m.emailAutomationActivationRowTriggered(
                  { date: triggeredAt },
                  { locale }
                )}
              </p>
            )}
            {sendAt && (
              <p className="text-navy-blue/65">
                {m.emailAutomationActivationRowSendAt(
                  { date: sendAt },
                  { locale }
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table
          aria-label={m.emailAutomationActivationRowsLabel({}, { locale })}
        >
          <TableHeader>
            <TableRow>
              {replay && (
                <TableHead>
                  {m.emailAutomationActivationColumnTriggered({}, { locale })}
                </TableHead>
              )}
              <TableHead>
                {m.emailAutomationActivationColumnCustomer({}, { locale })}
              </TableHead>
              <TableHead>
                {m.emailAutomationActivationColumnOutcome({}, { locale })}
              </TableHead>
              <TableHead>
                {m.emailAutomationActivationColumnSendAt({}, { locale })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ key, row, name, detail, triggeredAt, sendAt }) => (
              <TableRow key={key}>
                {replay && (
                  <TableCell className="whitespace-nowrap">
                    {triggeredAt}
                  </TableCell>
                )}
                <TableCell>
                  <CustomerCell detail={detail} name={name} />
                </TableCell>
                <TableCell>
                  <OutcomeCell flow={flow} locale={locale} row={row} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {sendAt ?? <span className="text-navy-blue/40">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function CustomerCell({
  detail,
  name,
}: {
  readonly detail: string | null;
  readonly name: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{name}</p>
      {detail && <p className="truncate text-navy-blue/60 text-xs">{detail}</p>}
    </div>
  );
}

function OutcomeCell({
  flow,
  locale,
  row,
}: {
  readonly flow: AutomationFlow | null;
  readonly locale: Locale;
  readonly row: AutomationDryRunRow;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={outcomeCopy[row.outcome].tone}>
        {outcomeCopy[row.outcome].label({}, { locale })}
      </StatusBadge>
      {row.outcome !== "would-send" && row.stepId && (
        <span className="text-navy-blue/60 text-xs">
          {automationStepLabelOrId({ flow, stepId: row.stepId, locale })}
        </span>
      )}
      {row.projected && (
        <RowFlag
          description={m.emailAutomationActivationFlagProjectedHint(
            {},
            { locale }
          )}
          label={m.emailAutomationActivationFlagProjected({}, { locale })}
        />
      )}
      {row.reservationStatusesApproximate && (
        <RowFlag
          description={m.emailAutomationActivationFlagApproximateHint(
            {},
            { locale }
          )}
          label={m.emailAutomationActivationFlagApproximate({}, { locale })}
        />
      )}
    </div>
  );
}

function RowFlag({
  description,
  label,
}: {
  readonly description: string;
  readonly label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="cursor-help" tabIndex={0} variant="subtle">
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{description}</TooltipContent>
    </Tooltip>
  );
}
