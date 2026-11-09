import { Plus } from "lucide-react";
import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";
import type { CampaignDelivery } from "../../campaign-states";
import { CampaignDeliveryFilterForm } from "./campaign-delivery-filter-form";
import type { loadCampaignList } from "./campaign-list-page-data.server";
import { CampaignListTable } from "./campaign-list-table";

type Campaigns = ReturnType<typeof loadCampaignList>;

/**
 * Every email campaign, or those of one delivery, with the action to start a
 * new one.
 */
export async function CampaignListPage({
  campaigns,
  delivery,
}: {
  readonly campaigns: Campaigns;
  readonly delivery: Promise<CampaignDelivery | undefined>;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <h1 className="sr-only">{m.emailCampaignsListTitle({}, { locale })}</h1>
      <AdministrationTableToolbar
        actions={
          <Button asChild size="md">
            <Link
              href={administrationHref("/[locale]/admin/email-campaigns/new")}
            >
              <Plus aria-hidden className="size-4" />
              {m.emailCampaignsListNewCampaign({}, { locale })}
            </Link>
          </Button>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.emailCampaignsListCountLoading({}, { locale })}
              />
            }
          >
            <CampaignCount campaigns={campaigns} locale={locale} />
          </Suspense>
        }
        filterLayout="inline"
        filters={<CampaignDeliveryFilterForm delivery={await delivery} />}
        label={m.emailCampaignsListTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={5}
            label={m.emailCampaignsListLoading({}, { locale })}
          />
        }
      >
        <CampaignCollection campaigns={campaigns} locale={locale} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CampaignCount({
  campaigns,
  locale,
}: {
  readonly campaigns: Campaigns;
  readonly locale: Locale;
}) {
  const count = (await campaigns).length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.emailCampaignsListCount({ count }, { locale })}
    />
  );
}

async function CampaignCollection({
  campaigns,
  locale,
}: {
  readonly campaigns: Campaigns;
  readonly locale: Locale;
}) {
  return (
    <CampaignListTable
      campaigns={(await campaigns).map((campaign) => ({
        ...campaign,
        updatedAtText: formatAdministrationDateTime(campaign.updatedAt, locale),
      }))}
    />
  );
}
