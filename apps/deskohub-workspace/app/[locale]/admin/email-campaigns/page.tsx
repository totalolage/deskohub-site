import { Plus } from "lucide-react";
import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
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
import { loadCampaignList } from "@/features/email-campaigns/admin/campaign-list/campaign-list-page-data.server";
import { CampaignListTable } from "@/features/email-campaigns/admin/campaign-list/campaign-list-table";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";

export default function EmailCampaignsPage() {
  const campaigns = loadCampaignList();
  const locale = getRequestLocale();
  return (
    <AdministrationPage>
      <h1 className="sr-only">
        <Suspense>
          <CampaignListTitle locale={locale} />
        </Suspense>
      </h1>
      <AdministrationTableToolbar
        actions={
          <Button asChild size="sm">
            <Link href="/admin/email-campaigns/new">
              <Plus aria-hidden className="size-4" />
              <Suspense>
                <NewCampaignLabel locale={locale} />
              </Suspense>
            </Link>
          </Button>
        }
        count={
          <Suspense fallback={<AdministrationCountLoading label="campaign" />}>
            <CampaignCount campaigns={campaigns} />
          </Suspense>
        }
        itemLabel="campaign"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading columns={5} label="campaigns" />
        }
      >
        <CampaignCollection campaigns={campaigns} />
      </Suspense>
    </AdministrationPage>
  );
}

type Campaigns = ReturnType<typeof loadCampaignList>;
type RequestLocale = ReturnType<typeof getRequestLocale>;

async function CampaignListTitle({
  locale,
}: {
  readonly locale: RequestLocale;
}) {
  return m.emailCampaignsListTitle({}, { locale: await locale });
}

async function NewCampaignLabel({
  locale,
}: {
  readonly locale: RequestLocale;
}) {
  return m.emailCampaignsListNewCampaign({}, { locale: await locale });
}

async function CampaignCount({ campaigns }: { readonly campaigns: Campaigns }) {
  return (
    <AdministrationTableCount
      count={(await campaigns).length}
      itemLabel="campaign"
    />
  );
}

async function CampaignCollection({
  campaigns,
}: {
  readonly campaigns: Campaigns;
}) {
  return (
    <CampaignListTable
      campaigns={(await campaigns).map((campaign) => ({
        ...campaign,
        updatedAtText: formatAdministrationDateTime(campaign.updatedAt),
      }))}
    />
  );
}
