import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
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
  return <CampaignListTable campaigns={await campaigns} />;
}
