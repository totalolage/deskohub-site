"use client";

import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
} from "@/features/checkout/product-catalog";
import type {
  CoworkReservationData,
  CoworkReservationInput,
} from "@/features/reservation/cowork-reservation";
import {
  getCoworkWorkstationNormalization,
  getCoworkWorkstationOrigin,
} from "@/features/reservation/cowork-selection-availability";

type CoworkAddonSelection = Pick<
  CoworkReservationInput,
  "date" | "entryTier" | "monitorOption"
>;

/**
 * Whether the form still holds the watched selection, so a normalization
 * never acts on values the customer has already changed.
 */
const isSelectionCurrent = (
  values: CoworkAddonSelection,
  selection: CoworkAddonSelection
) =>
  values.entryTier === selection.entryTier &&
  values.date === selection.date &&
  values.monitorOption === selection.monitorOption;

/**
 * Keeps the cowork form's addons valid for the selected tier and day: drops
 * the workstation and includes coffee where the tier doesn't offer them as
 * options, and adds, replaces, or removes a Reserved Desk workstation as the
 * day's requirement changes.
 */
export const useCoworkAddonNormalization = ({
  form,
  selection,
  workstation: {
    isSelectedMonitorUnavailable,
    normalizable,
    requiredMonitorOption,
  },
}: {
  readonly form: UseFormReturn<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly selection: CoworkAddonSelection;
  readonly workstation: Parameters<typeof getCoworkWorkstationNormalization>[0];
}) => {
  const { date, entryTier, monitorOption } = selection;
  const isCoffeeOptional = getCoworkTierCoffeeAddon(entryTier) === "optional";
  const isWorkstationOptional =
    getCoworkTierWorkstationAddon(entryTier) === "optional";
  // Whether the form added the current workstation itself. Customer choices
  // and tier changes reset it.
  const autoAddedWorkstation = useRef(false);

  useEffect(() => {
    if (isWorkstationOptional) {
      const values = form.getValues();
      if (!isSelectionCurrent(values, { date, entryTier, monitorOption })) {
        return;
      }

      const normalized = getCoworkWorkstationNormalization(
        { isSelectedMonitorUnavailable, normalizable, requiredMonitorOption },
        {
          monitorOption,
          origin: getCoworkWorkstationOrigin({
            autoAdded: autoAddedWorkstation.current,
            monitorOption,
          }),
        }
      );
      if (!normalized) return;

      autoAddedWorkstation.current = normalized.origin === "auto-added";
      form.setValue("monitorOption", normalized.monitorOption, {
        shouldValidate: true,
      });
      return;
    }

    autoAddedWorkstation.current = false;
    form.setValue("monitorOption", undefined, { shouldValidate: true });
    if (!isCoffeeOptional) {
      form.setValue("coffee", true, { shouldValidate: true });
    }
  }, [
    date,
    entryTier,
    form,
    isCoffeeOptional,
    isSelectedMonitorUnavailable,
    isWorkstationOptional,
    monitorOption,
    normalizable,
    requiredMonitorOption,
  ]);

  return {
    isCoffeeOptional,
    isWorkstationOptional,
    onManualWorkstationSelection: () => {
      autoAddedWorkstation.current = false;
    },
    /** Drops the addons the newly chosen tier doesn't offer as options. */
    onTierChange: (tier: CoworkReservationInput["entryTier"]) => {
      if (getCoworkTierWorkstationAddon(tier) !== "optional") {
        autoAddedWorkstation.current = false;
        form.setValue("monitorOption", undefined);
      }
      if (getCoworkTierCoffeeAddon(tier) !== "optional") {
        form.setValue("coffee", true);
      }
    },
  };
};
