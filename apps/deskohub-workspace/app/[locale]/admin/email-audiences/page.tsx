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
import { AudienceList } from "@/features/email-campaigns/admin/audiences/audience-list";
import {
  type AudienceListItem,
  loadAudienceList,
} from "@/features/email-campaigns/admin/audiences/audience-page-data.server";
import { Button } from "@/shared/components/ui/button";

type AudienceListData = Promise<readonly AudienceListItem[]>;

export default function EmailAudiencesPage() {
  const audiences = loadAudienceList();
  return (
    <AdministrationPage>
      <h1 className="sr-only">Email audiences</h1>
      <AdministrationTableToolbar
        actions={
          <Button asChild size="sm">
            <Link href="/admin/email-audiences/new">New audience</Link>
          </Button>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading label="Loading audience count" />
            }
          >
            <AudiencesCount audiences={audiences} />
          </Suspense>
        }
        label="audience table controls"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={4}
            label="Loading audiences"
          />
        }
      >
        <AudiencesCollection audiences={audiences} />
      </Suspense>
    </AdministrationPage>
  );
}

async function AudiencesCount({
  audiences,
}: {
  readonly audiences: AudienceListData;
}) {
  const count = (await audiences).length;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} audience${count === 1 ? "" : "s"}`}
    />
  );
}

async function AudiencesCollection({
  audiences,
}: {
  readonly audiences: AudienceListData;
}) {
  return <AudienceList audiences={await audiences} />;
}
