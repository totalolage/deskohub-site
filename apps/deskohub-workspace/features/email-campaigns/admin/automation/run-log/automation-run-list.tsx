import {
  AdministrationCampaignRecipientSkipReason,
  type AutomationFlow,
  type AutomationRunOutcome,
  type AutomationRunState,
  type AutomationRunSummary,
  type AutomationVersionSummary,
} from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import { AdministrationLink } from "@/features/administration/admin-link";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { EmptyState } from "@/features/administration/empty-state";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
} from "@/features/administration/filter-controls";
import { m } from "@/features/administration/i18n";
import {
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/table-toolbar";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import type { SearchParamValues } from "@/shared/utils/search-params";
import { upperCaseFirst } from "@/shared/utils/text-case";
import { automationTriggerLabel } from "../automation-trigger-labels";
import { AutomationRunCustomer } from "./automation-run-customer";
import type { AutomationRunFilters } from "./automation-run-filters";
import type { AutomationFlowsByVersion } from "./automation-run-log.server";
import {
  AutomationRunStatus,
  automationRunOutcomeLabel,
  automationRunSkipReasonLabel,
} from "./automation-run-status";
import { automationStepLabelOrId } from "./automation-step-label";

const stateOptions = {
  active: m.emailAutomationRunsStateActive,
  sending: m.emailAutomationRunsStateSending,
  ended: m.emailAutomationRunsStateEnded,
} satisfies Record<AutomationRunState, typeof m.emailAutomationRunsStateActive>;

const outcomeOptions = [
  "sent",
  "unconfirmed",
  "condition-failed",
  "skipped",
  "failed",
  "withdrawn",
  "archived",
] as const satisfies readonly AutomationRunOutcome[];

function AutomationRunFilterForm({
  action,
  filters,
  flow,
  locale,
  versions,
}: {
  readonly action: AdministrationHref;
  readonly filters: AutomationRunFilters;
  readonly flow: AutomationFlow | null;
  readonly locale: Locale;
  readonly versions: readonly AutomationVersionSummary[];
}) {
  return (
    <AdministrationFilterForm
      action={action}
      className="grid @2xl:grid-cols-3 @6xl:flex @6xl:flex-nowrap"
      variant="standalone"
    >
      <AdministrationFilterField
        htmlFor="automation-run-state"
        label={m.emailAutomationRunsFilterState({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={Option.getOrElse(filters.state, () => "")}
          id="automation-run-state"
          name="state"
        >
          <option value="">
            {m.emailAutomationRunsFilterStateAny({}, { locale })}
          </option>
          {Object.entries(stateOptions).map(([state, label]) => (
            <option key={state} value={state}>
              {label({}, { locale })}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="automation-run-outcome"
        label={m.emailAutomationRunsFilterOutcome({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={Option.getOrElse(filters.outcome, () => "")}
          id="automation-run-outcome"
          name="outcome"
        >
          <option value="">
            {m.emailAutomationRunsFilterOutcomeAny({}, { locale })}
          </option>
          {outcomeOptions.map((outcome) => (
            <option key={outcome} value={outcome}>
              {automationRunOutcomeLabel(outcome, locale)}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="automation-run-skip-reason"
        label={m.emailAutomationRunsFilterSkipReason({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={Option.getOrElse(filters.skipReason, () => "")}
          id="automation-run-skip-reason"
          name="skipReason"
        >
          <option value="">
            {m.emailAutomationRunsFilterSkipReasonAny({}, { locale })}
          </option>
          {AdministrationCampaignRecipientSkipReason.literals.map((reason) => (
            <option key={reason} value={reason}>
              {upperCaseFirst(
                automationRunSkipReasonLabel(reason, locale),
                locale
              )}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="automation-run-step"
        label={m.emailAutomationRunsFilterStep({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={Option.getOrElse(filters.stepId, () => "")}
          id="automation-run-step"
          name="step"
        >
          <option value="">
            {m.emailAutomationRunsFilterStepAny({}, { locale })}
          </option>
          {flow?.steps.map(({ id }) => (
            <option key={id} value={id}>
              {automationStepLabelOrId({ flow, stepId: id, locale })}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="automation-run-version"
        label={m.emailAutomationRunsFilterVersion({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={Option.getOrElse(
            Option.map(filters.versionNumber, String),
            () => ""
          )}
          id="automation-run-version"
          name="version"
        >
          <option value="">
            {m.emailAutomationRunsFilterVersionAll({}, { locale })}
          </option>
          {versions.map(({ active, versionNumber }) => (
            <option key={versionNumber} value={versionNumber}>
              {active
                ? m.emailAutomationRunsVersionLive(
                    { versionNumber },
                    { locale }
                  )
                : m.emailAutomationRunsVersion({ versionNumber }, { locale })}
            </option>
          ))}
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="automation-run-customer"
        label={m.emailAutomationRunsFilterCustomer({}, { locale })}
      >
        <AdministrationFilterInput
          autoComplete="off"
          defaultValue={Option.getOrElse(filters.customerId, () => "")}
          id="automation-run-customer"
          name="customer"
          placeholder={m.emailAutomationRunsFilterCustomerPlaceholder(
            {},
            { locale }
          )}
        />
      </AdministrationFilterField>
      <div className="flex items-end gap-2">
        <Button size="md" type="submit">
          {m.emailAutomationRunsFilterApply({}, { locale })}
        </Button>
        <Button asChild size="md" variant="ghost">
          <AdministrationLink href={action}>
            {m.emailAutomationRunsFilterClear({}, { locale })}
          </AdministrationLink>
        </Button>
      </div>
    </AdministrationFilterForm>
  );
}

interface RunRowCopy {
  readonly run: AutomationRunSummary;
  readonly href: AdministrationHref;
  readonly started: string;
  readonly ended: string | null;
  readonly trigger: string;
  readonly triggeredAt: string;
  readonly step: string;
  readonly version: string;
}

function RunCard({
  locale,
  row,
}: {
  readonly locale: Locale;
  readonly row: RunRowCopy;
}) {
  return (
    <li className="grid gap-2 rounded-xl border border-navy-blue/10 bg-white p-4 text-sm">
      <div className="flex flex-col items-start gap-1.5">
        <AdministrationLink
          className="font-semibold underline underline-offset-4"
          href={row.href}
        >
          {row.started}
        </AdministrationLink>
        <AutomationRunStatus locale={locale} run={row.run} />
      </div>
      <dl className="grid @xl:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-navy-blue/70">
        <dt>{m.emailAutomationRunsColumnCustomer({}, { locale })}</dt>
        <dd className="min-w-0">
          <AutomationRunCustomer locale={locale} run={row.run} />
        </dd>
        <dt>{m.emailAutomationRunsColumnVersion({}, { locale })}</dt>
        <dd>{row.version}</dd>
        <dt>{m.emailAutomationRunsColumnStep({}, { locale })}</dt>
        <dd>{row.step}</dd>
        <dt>{m.emailAutomationRunsColumnTrigger({}, { locale })}</dt>
        <dd>
          {row.trigger} · {row.triggeredAt}
        </dd>
        {row.ended !== null && (
          <>
            <dt>{m.emailAutomationRunsColumnEnded({}, { locale })}</dt>
            <dd>{row.ended}</dd>
          </>
        )}
      </dl>
    </li>
  );
}

function RunTable({
  locale,
  rows,
}: {
  readonly locale: Locale;
  readonly rows: readonly RunRowCopy[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {m.emailAutomationRunsColumnStarted({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnCustomer({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnTrigger({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnStep({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnStatus({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnEnded({}, { locale })}
            </TableHead>
            <TableHead>
              {m.emailAutomationRunsColumnVersion({}, { locale })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.run.runId}>
              <TableCell className="whitespace-nowrap">
                <AdministrationLink
                  className="font-medium underline underline-offset-4"
                  href={row.href}
                >
                  {row.started}
                </AdministrationLink>
              </TableCell>
              <TableCell>
                <AutomationRunCustomer locale={locale} run={row.run} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <div>{row.trigger}</div>
                <div className="text-navy-blue/65 text-xs">
                  {row.triggeredAt}
                </div>
              </TableCell>
              <TableCell>{row.step}</TableCell>
              <TableCell>
                <AutomationRunStatus locale={locale} run={row.run} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-navy-blue/70">
                {row.ended ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-navy-blue/70">
                {row.version}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The campaign's runs, newest first, filtered by the URL, one cursor page at
 * a time: a table in a wide slot, stacked cards in a narrow one.
 */
export function AutomationRunList({
  basePath,
  filtered,
  filters,
  flow,
  flows,
  href,
  locale,
  nextCursor,
  runs,
  versions,
}: {
  readonly basePath: AdministrationHref;
  readonly filtered: boolean;
  readonly filters: AutomationRunFilters;
  readonly flow: AutomationFlow | null;
  readonly flows: AutomationFlowsByVersion;
  /** The run list with the current filters and `params`. */
  readonly href: (params: SearchParamValues) => AdministrationHref;
  readonly locale: Locale;
  readonly nextCursor: string | null;
  readonly runs: readonly AutomationRunSummary[];
  readonly versions: readonly AutomationVersionSummary[];
}) {
  const rows = runs.map(
    (run): RunRowCopy => ({
      run,
      href: administrationHref(
        "/[locale]/admin/email-campaigns/[campaignId]/runs/[runId]",
        { campaignId: run.campaignId, runId: run.runId }
      ),
      started: formatAdministrationDateTime(run.startedAt, locale),
      ended:
        run.endedAt === null
          ? null
          : formatAdministrationDateTime(run.endedAt, locale),
      trigger: automationTriggerLabel(run.triggerKind, locale),
      triggeredAt: formatAdministrationDateTime(run.triggerAt, locale),
      step: automationStepLabelOrId({
        flow: flows.get(run.versionNumber) ?? null,
        stepId: run.stepId,
        locale,
      }),
      version: m.emailAutomationRunsVersion(
        { versionNumber: run.versionNumber },
        { locale }
      ),
    })
  );
  const laterPage = Option.isSome(filters.cursor);
  return (
    <section className="grid gap-0">
      <AdministrationTableToolbar
        count={
          <AdministrationTableCount
            count={runs.length}
            label={m.emailAutomationRunsListCount(
              { count: runs.length },
              { locale }
            )}
          />
        }
        filters={
          <AutomationRunFilterForm
            action={basePath}
            filters={filters}
            flow={flow}
            locale={locale}
            versions={versions}
          />
        }
        label={m.emailAutomationRunsListControls({}, { locale })}
      />
      {rows.length === 0 ? (
        <EmptyState
          message={
            filtered
              ? m.emailAutomationRunsListEmptyFiltered({}, { locale })
              : m.emailAutomationRunsListEmpty({}, { locale })
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 @3xl:hidden">
            {rows.map((row) => (
              <RunCard key={row.run.runId} locale={locale} row={row} />
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <RunTable locale={locale} rows={rows} />
          </div>
        </>
      )}
      {(laterPage || nextCursor !== null) && (
        <nav
          aria-label={m.emailAutomationRunsPagination({}, { locale })}
          className="mt-4 flex flex-wrap justify-end gap-2"
        >
          {laterPage && (
            <Button asChild size="sm" variant="secondary">
              <AdministrationLink href={href({ cursor: undefined })}>
                {m.emailAutomationRunsFirstPage({}, { locale })}
              </AdministrationLink>
            </Button>
          )}
          {nextCursor !== null && (
            <Button asChild size="sm" variant="secondary">
              <AdministrationLink href={href({ cursor: nextCursor })}>
                {m.emailAutomationRunsNextPage({}, { locale })}
              </AdministrationLink>
            </Button>
          )}
        </nav>
      )}
    </section>
  );
}
