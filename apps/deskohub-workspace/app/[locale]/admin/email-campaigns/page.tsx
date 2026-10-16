import { Plus } from "lucide-react";
import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import { loadCampaignList } from "@/features/email-campaigns/admin/campaign-list/campaign-list-page-data.server";
import { CampaignListTable } from "@/features/email-campaigns/admin/campaign-list/campaign-list-table";
import { Button } from "@/shared/components/ui/button";

export default function EmailCampaignsPage() {
  const campaigns = loadCampaignList();
  return (
    <AdministrationPage>
      <h1 className="sr-only">Email campaigns</h1>
      <AdministrationTableToolbar
        actions={
          <Button asChild size="sm">
            <Link href="/admin/email-campaigns/new">
              <Plus aria-hidden className="size-4" />
              New campaign
            </Link>
          </Button>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading label="Loading campaign count" />
            }
          >
            <CampaignCount campaigns={campaigns} />
          </Suspense>
        }
        label="campaign table controls"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={5}
            label="Loading campaigns"
          />
        }
      >
        <CampaignCollection campaigns={campaigns} />
      </Suspense>
    </AdministrationPage>
  );
}

type Campaigns = ReturnType<typeof loadCampaignList>;

async function CampaignCount({ campaigns }: { readonly campaigns: Campaigns }) {
  const count = (await campaigns).length;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} campaign${count === 1 ? "" : "s"}`}
    />
  );
}

async function CampaignCollection({
  campaigns,
}: {
  readonly campaigns: Campaigns;
}) {
  return <CampaignListTable campaigns={await campaigns} />;
}
