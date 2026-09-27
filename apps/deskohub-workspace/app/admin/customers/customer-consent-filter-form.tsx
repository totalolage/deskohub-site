"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterSelect,
} from "@/features/administration/components";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function CustomerConsentFilterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const consent = searchParams.get("consent") ?? "";
  const sort = searchParams.get("sort") ?? "activity";
  const direction = searchParams.get("direction") ?? "desc";

  return (
    <AdministrationFilterForm
      key={`${consent}|${sort}|${direction}`}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const params = new URLSearchParams();
        for (const key of ["consent", "sort", "direction"]) {
          const value = formData.get(key);
          if (value !== null) params.set(key, String(value));
        }
        router.push(`/admin/customers?${params.toString()}`);
      }}
      variant="toolbar"
    >
      <AdministrationFilterField
        htmlFor="customer-consent"
        label={m.adminCustomersFilterConsentLabel({})}
      >
        <AdministrationFilterSelect
          defaultValue={consent}
          id="customer-consent"
          name="consent"
        >
          <option value="">{m.adminCustomersFilterConsentAll({})}</option>
          <option value="granted">
            {m.adminCustomersFilterConsentGranted({})}
          </option>
          <option value="withdrawn">
            {m.adminCustomersFilterConsentWithdrawn({})}
          </option>
          <option value="never">
            {m.adminCustomersFilterConsentNeverGranted({})}
          </option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <input name="sort" type="hidden" value={sort} />
      <input name="direction" type="hidden" value={direction} />
      <div className="sm:col-span-2 2xl:col-span-1 2xl:justify-self-end">
        <Button className="min-h-10" size="sm" type="submit">
          {m.adminCustomersFilterApply({})}
        </Button>
      </div>
    </AdministrationFilterForm>
  );
}
