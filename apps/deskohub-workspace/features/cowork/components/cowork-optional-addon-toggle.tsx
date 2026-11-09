"use client";

import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ReservationSkeletonBlock } from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import { Button } from "@/shared/components/ui/button";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  FormControl,
  FormItemLayout,
  useFormField,
} from "@/shared/components/ui/form";
import { Switch } from "@/shared/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

type CoworkOptionalAddonToggleProps = {
  readonly addon: "coffee" | "workstation";
  readonly checked: boolean;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly icon: LucideIcon;
  readonly info?: {
    readonly triggerLabel: string;
    readonly content: string;
  };
  readonly label: string;
  readonly onBlur?: () => void;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly priceLabel?: string;
};

/**
 * Shared visual presentation for the one optional paid cowork add-on
 * (coffee or workstation). Domain controllers bind it to their field and
 * keep the price test hooks on the same markup path. It owns the field's
 * label/control stack, so the label spacing matches every other field;
 * `children` render below the control inside that stack.
 */
export function CoworkOptionalAddonToggle({
  addon,
  checked,
  children,
  disabled,
  icon: Icon,
  info,
  label,
  onBlur,
  onCheckedChange,
  priceLabel,
}: CoworkOptionalAddonToggleProps) {
  const { formItemId } = useFormField();

  return (
    <FormItemLayout data-cowork-addon-control>
      <ReservationFormLabel>{label}</ReservationFormLabel>
      <div className="flex items-center gap-2">
        <ChoiceCard
          align="center"
          className="flex-1"
          data-cowork-optional-addon-toggle={addon}
          htmlFor={formItemId}
        >
          <span className="flex items-center gap-3">
            <Icon className="h-5 w-5 shrink-0 text-burned-orange" />
            <FormControl>
              <Switch
                checked={checked}
                disabled={disabled}
                onBlur={onBlur}
                onCheckedChange={onCheckedChange}
              />
            </FormControl>
          </span>
          <span
            className="ml-auto"
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
        </ChoiceCard>
        {info && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  tone="muted"
                  size="icon-lg"
                  aria-label={info.triggerLabel}
                  className="shrink-0"
                >
                  <Info aria-hidden="true" className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                align="end"
                collisionPadding={16}
                className="w-[min(22rem,calc(100vw-2rem))] p-4"
                side="top"
              >
                <p>{info.content}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {children}
    </FormItemLayout>
  );
}
