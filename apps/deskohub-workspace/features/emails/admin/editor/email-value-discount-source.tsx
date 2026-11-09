"use client";

import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { EmailDraftValueSource } from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailValueNumberInput } from "./email-value-number-input";
import type { EmailEditorDiscount } from "./email-values-section";

type NumberSetting = "validDays" | "maxUses" | "maxUsesPerCustomer";

const numberSettings = [
  { setting: "validDays", label: m.emailsEditorValuesValidDaysLabel },
  { setting: "maxUses", label: m.emailsEditorValuesMaxUsesLabel },
  {
    setting: "maxUsesPerCustomer",
    label: m.emailsEditorValuesMaxUsesPerCustomerLabel,
  },
] as const satisfies readonly {
  readonly setting: NumberSetting;
  readonly label: typeof m.emailsEditorValuesMaxUsesLabel;
}[];

/** The discount a discount value issues codes from, and the codes' limits. */
export function EmailValueDiscountSource({
  discounts,
  index,
  onChange,
  source,
}: {
  readonly discounts: readonly EmailEditorDiscount[];
  readonly index: number;
  readonly onChange: (source: EmailDraftValueSource) => void;
  readonly source: EmailDraftValueSource;
}) {
  const locale = useRouteLocale();
  const discountId = emailEditorFieldIds.valueSetting(index, "discountId");
  const discountProblems = useEmailFieldProblems(discountId);
  const chosen = source.discountId;
  const missing =
    chosen !== undefined && !discounts.some(({ id }) => id === chosen);
  const changeNumber = (setting: NumberSetting, value: number | undefined) => {
    const { [setting]: _previous, ...rest } = source;
    onChange(value === undefined ? rest : { ...rest, [setting]: value });
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={discountId}>
          {m.emailsEditorValuesDiscountLabel({}, { locale })}
        </Label>
        <Select
          value={chosen ?? ""}
          onValueChange={(id) => onChange({ ...source, discountId: id })}
        >
          <SelectTrigger
            id={discountId}
            className="min-h-9 w-auto min-w-56 max-w-full rounded-md px-3 py-1.5 text-sm"
            variant={discountProblems.invalid ? "error" : "default"}
            {...discountProblems.controlProps}
          >
            <SelectValue
              placeholder={m.emailsEditorValuesDiscountChoose({}, { locale })}
            />
          </SelectTrigger>
          <SelectContent>
            {missing && (
              <SelectItem value={chosen}>
                {m.emailsEditorValuesDiscountMissing({}, { locale })}
              </SelectItem>
            )}
            {discounts.map((discount) => (
              <SelectItem key={discount.id} value={discount.id}>
                {discount.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-navy-blue/55 text-xs">
          {m.emailsEditorValuesDiscountHint({}, { locale })}
        </p>
        <EmailFieldProblems fieldId={discountId} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        {numberSettings.map(({ setting, label }) => (
          <EmailValueNumberInput
            key={setting}
            id={emailEditorFieldIds.valueSetting(index, setting)}
            label={label({}, { locale })}
            value={source[setting]}
            onChange={(value) => changeNumber(setting, value)}
          />
        ))}
      </div>
    </>
  );
}
