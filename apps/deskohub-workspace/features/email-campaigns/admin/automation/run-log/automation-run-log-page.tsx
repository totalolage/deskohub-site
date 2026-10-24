import { Option, Result } from "effect";
import { AdministrationLink } from "@/features/administration/admin-link";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import {
  type AdministrationListParams,
  getAdministrationListHref,
} from "@/features/administration/list-href";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import type { AutomatedCampaign } from "../automated-campaign.server";
import { AutomationEngineHealthIndicator } from "./automation-engine-health";
import { AutomationRunCounts } from "./automation-run-counts";
import { automationRunContactsUnavailable } from "./automation-run-customer";
import {
  type AutomationRunSearchParams,
  automationRunFilterParams,
  hasAutomationRunFilters,
  parseAutomationRunFilters,
} from "./automation-run-filters";
import { AutomationRunList } from "./automation-run-list";
import {
  type AutomationRunLogFailure,
  loadAutomationRunLog,
} from "./automation-run-log.server";

function LoadFailure({
  failure,
  firstPageHref,
  locale,
}: {
  readonly failure: AutomationRunLogFailure;
  readonly firstPageHref?: string | undefined;
  readonly locale: Locale;
}) {
  return (
    <AdministrationAlert status="error">
      {describeCampaignOperationFailure(
        failure,
        {
          fallback: (locale) => m.emailAutomationRunsLoadFailed({}, { locale }),
          codes: {
            "automation-page-cursor-invalid": (locale) =>
              m.emailAutomationRunsCursorInvalid({}, { locale }),
          },
        },
        locale
      )}
      {firstPageHref !== undefined && (
        <>
          {" "}
          <AdministrationLink
            className="font-semibold underline underline-offset-4"
            href={firstPageHref}
          >
            {m.emailAutomationRunsFirstPage({}, { locale })}
          </AdministrationLink>
        </>
      )}
    </AdministrationAlert>
  );
}

/** Run counts by state, and the filterable list of runs. */
export async function AutomationRunLogPage({
  automated,
  searchParams,
}: {
  readonly automated: AutomatedCampaign;
  readonly searchParams: AutomationRunSearchParams;
}) {
  const locale = await getRequestLocale();
  const filters = parseAutomationRunFilters(searchParams);
  const log = await loadAutomationRunLog(automated, filters);
  const basePath = `/admin/email-campaigns/${automated.campaign.id}/runs`;
  const current = automationRunFilterParams(filters);
  const listHref = (params: AdministrationListParams) =>
    getAdministrationListHref(basePath, { ...current, ...params });
  const countsHref = (params: AdministrationListParams) =>
    getAdministrationListHref(basePath, {
      version: current.version,
      ...params,
    });
  const versions = Result.getOrUndefined(log.summary)?.versions ?? [];
  return (
    <div className="@container grid gap-6">
      <AutomationEngineHealthIndicator
        campaignId={automated.campaign.id}
        checkedAt={log.checkedAt}
        health={log.health}
        locale={locale}
      />
      {Result.match(log.summary, {
        onFailure: (failure) => (
          <LoadFailure failure={failure} locale={locale} />
        ),
        onSuccess: ({ stats }) => (
          <AutomationRunCounts
            flow={log.flow}
            href={countsHref}
            locale={locale}
            scope={Option.match(filters.versionNumber, {
              onNone: () => m.emailAutomationRunsCountsScopeAll({}, { locale }),
              onSome: (versionNumber) =>
                m.emailAutomationRunsCountsScopeVersion(
                  { versionNumber },
                  { locale }
                ),
            })}
            stats={stats}
          />
        ),
      })}
      {Result.match(log.runs, {
        onFailure: (failure) => (
          <LoadFailure
            failure={failure}
            firstPageHref={
              Option.isSome(filters.cursor)
                ? listHref({ cursor: undefined })
                : undefined
            }
            locale={locale}
          />
        ),
        onSuccess: ({ nextCursor, runs }) => (
          <div className="grid gap-3">
            {automationRunContactsUnavailable(runs) && (
              <AdministrationAlert status="warning">
                {m.emailAutomationRunsCustomerContactsUnavailable(
                  {},
                  { locale }
                )}
              </AdministrationAlert>
            )}
            <AutomationRunList
              basePath={basePath}
              filtered={hasAutomationRunFilters(filters)}
              filters={filters}
              flow={log.flow}
              flows={log.flows}
              href={listHref}
              locale={locale}
              nextCursor={nextCursor}
              runs={runs}
              versions={versions}
            />
          </div>
        ),
      })}
    </div>
  );
}
