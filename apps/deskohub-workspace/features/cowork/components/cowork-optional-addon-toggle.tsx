"use client";

import type { LucideIcon } from "lucide-react";
import { ReservationSkeletonBlock } from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import { FormControl, useFormField } from "@/shared/components/ui/form";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";

type CoworkOptionalAddonToggleProps = {
  readonly addon: "coffee" | "workstation";
  readonly checked: boolean;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onBlur?: () => void;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly priceLabel?: string;
};

/**
 * Shared visual presentation for the one optional paid cowork add-on
 * (coffee or workstation). Domain controllers bind it to their field and
 * keep the price test hooks on the same markup path.
 */
export function CoworkOptionalAddonToggle({
  addon,
  checked,
  icon: Icon,
  label,
  onBlur,
  onCheckedChange,
  priceLabel,
}: CoworkOptionalAddonToggleProps) {
  const { formItemId } = useFormField();

  return (
    <>
      <ReservationFormLabel>{label}</ReservationFormLabel>
      <Label
        className="flex h-13 cursor-pointer items-center justify-between gap-3 rounded-[1.1rem] border border-navy-blue/10 bg-linear-to-br from-sunset-yellow/18 to-white px-4 py-3 text-navy-blue transition hover:border-burned-orange/30"
        data-cowork-optional-addon-toggle={addon}
        htmlFor={formItemId}
      >
        <span className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-burned-orange" />
          <FormControl>
            <Switch
              checked={checked}
              onBlur={onBlur}
              onCheckedChange={onCheckedChange}
            />
          </FormControl>
        </span>
        <span
          {...{
            coffee: { "data-reservation-coffee-price": "" },
            workstation: { "data-reservation-workstation-price": "" },
          }[addon]}
        >
          {priceLabel ? (
            <span className="text-sm font-semibold text-navy-blue before:content-['+']">
              {priceLabel}
            </span>
          ) : (
            <ReservationSkeletonBlock className="h-4 w-14 bg-sunset-yellow/25" />
          )}
        </span>
      </Label>
    </>
  );
}
