"use client";

import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterSelect,
} from "@/features/administration/filter-controls";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import type { CampaignDelivery } from "../../campaign-states";

/** Narrows the campaign list to one-off or automated campaigns. */
export function CampaignDeliveryFilterForm({
  delivery,
}: {
  readonly delivery: CampaignDelivery | undefined;
}) {
  const locale = useRouteLocale();
  return (
    <AdministrationFilterForm
      action="/admin/email-campaigns"
      variant="standalone"
    >
      <AdministrationFilterField
        className="w-48"
        htmlFor="campaign-delivery"
        label={m.emailAutomationsListDeliveryFilter({}, { locale })}
      >
        <AdministrationFilterSelect
          defaultValue={delivery ?? ""}
          id="campaign-delivery"
          name="delivery"
        >
          <option value="">
            {m.emailAutomationsListDeliveryAll({}, { locale })}
          </option>
          <option value="once">
            {m.emailAutomationsListDeliveryOnce({}, { locale })}
          </option>
          <option value="automated">
            {m.emailAutomationsListDeliveryAutomated({}, { locale })}
          </option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <fieldset
        aria-label={m.administrationFilterActions({}, { locale })}
        className="flex min-w-0 items-center justify-end gap-2 self-end border-0 p-0"
      >
        {delivery && (
          <Button asChild size="md" variant="ghost">
            <Link href="/admin/email-campaigns">
              {m.administrationFilterClear({}, { locale })}
            </Link>
          </Button>
        )}
        <Button size="md" type="submit">
          {m.administrationFilterApply({}, { locale })}
        </Button>
      </fieldset>
    </AdministrationFilterForm>
  );
}
