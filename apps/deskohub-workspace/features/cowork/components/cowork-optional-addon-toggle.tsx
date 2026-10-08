"use client";

import { Info, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { ReservationSkeletonBlock } from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import { Button } from "@/shared/components/ui/button";
import { FormControl, useFormField } from "@/shared/components/ui/form";
import { Label } from "@/shared/components/ui/label";
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
 * keep the price test hooks on the same markup path.
 */
export function CoworkOptionalAddonToggle({
  addon,
  checked,
  disabled,
  icon: Icon,
  info,
  label,
  onBlur,
  onCheckedChange,
  priceLabel,
}: CoworkOptionalAddonToggleProps) {
  const { formItemId } = useFormField();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const isTouchTooltipOpen = useRef(false);

  return (
    <>
      <ReservationFormLabel>{label}</ReservationFormLabel>
      <div className="flex items-center gap-2">
        <Label
          className="flex h-13 flex-1 cursor-pointer items-center justify-between gap-3 rounded-[1.1rem] border border-navy-blue/10 bg-linear-to-br from-sunset-yellow/18 to-white px-4 py-3 text-navy-blue transition hover:border-burned-orange/30"
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
        {info && (
          <TooltipProvider delayDuration={0}>
            <Tooltip
              open={isTooltipOpen}
              onOpenChange={(open) => {
                if (isTouchTooltipOpen.current && !open) return;
                setIsTooltipOpen(open);
              }}
            >
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={info.triggerLabel}
                  className="h-11 w-11 shrink-0 rounded-full p-0 text-navy-blue/60"
                  onPointerDown={(event) => {
                    if (event.pointerType !== "touch") return;
                    const open = !isTouchTooltipOpen.current;
                    isTouchTooltipOpen.current = open;
                    setIsTooltipOpen(open);
                  }}
                >
                  <Info aria-hidden="true" className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                align="end"
                collisionPadding={16}
                className="w-[min(22rem,calc(100vw-2rem))] p-4"
                onEscapeKeyDown={() => {
                  isTouchTooltipOpen.current = false;
                  setIsTooltipOpen(false);
                }}
                side="top"
              >
                <p>{info.content}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </>
  );
}
