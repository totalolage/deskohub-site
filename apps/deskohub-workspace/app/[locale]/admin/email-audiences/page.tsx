import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import { AudienceList } from "@/features/email-campaigns/admin/audiences/audience-list";
import {
  type AudienceListItem,
  loadAudienceList,
} from "@/features/email-campaigns/admin/audiences/audience-page-data.server";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";

type AudienceListData = Promise<readonly AudienceListItem[]>;

export default function EmailAudiencesPage() {
  return <EmailAudiences />;
}

async function EmailAudiences() {
  const locale = await getRequestLocale();
  const audiences = loadAudienceList();
  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.emailCampaignsAudienceListTitle({}, { locale })}
      </h1>
      <AdministrationTableToolbar
        actions={
          <Button asChild size="sm">
            <Link
              href={administrationHref("/[locale]/admin/email-audiences/new")}
            >
              {m.emailCampaignsAudienceListNew({}, { locale })}
            </Link>
          </Button>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.emailCampaignsAudienceListCountLoading({}, { locale })}
              />
            }
          >
            <AudiencesCount audiences={audiences} locale={locale} />
          </Suspense>
        }
        label={m.emailCampaignsAudienceListToolbarLabel({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={4}
            label={m.emailCampaignsAudienceListLoading({}, { locale })}
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
  locale,
}: {
  readonly audiences: AudienceListData;
  readonly locale: Locale;
}) {
  const count = (await audiences).length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.emailCampaignsAudienceListCount({ count }, { locale })}
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
