"use client";

import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  type WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import type {
  CoworkReservationData,
  CoworkReservationInput,
} from "@/features/reservation/cowork-reservation";

type CoworkAddonSelection = Pick<
  CoworkReservationInput,
  "date" | "entryTier" | "monitorOption"
>;

/**
 * Whether the form still holds the watched Reserved Desk selection, so a
 * normalization never acts on values the customer has already changed.
 */
export const isReservedDeskSelectionCurrent = (
  values: CoworkAddonSelection,
  selection: CoworkAddonSelection
) =>
  selection.entryTier === "reserved-desk" &&
  values.entryTier === selection.entryTier &&
  values.date === selection.date &&
  values.monitorOption === selection.monitorOption;

/**
 * The monitor option a Reserved Desk needs on the selected day: the first
 * available one while the day requires a workstation and none, or an
 * unavailable one, is chosen; none once the requirement lifts from a
 * workstation the form added itself. Undefined leaves the choice alone.
 */
export const getReservedDeskWorkstationNormalization = ({
  autoAdded,
  firstAvailableMonitorOption,
  isRequired,
  monitorOption,
  unavailableMonitorOptions,
}: {
  readonly autoAdded: boolean;
  readonly firstAvailableMonitorOption?: WorkspaceProductMonitorOption;
  readonly isRequired: boolean;
  readonly monitorOption: CoworkReservationInput["monitorOption"];
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) => {
  if (!isRequired || !firstAvailableMonitorOption) {
    return autoAdded
      ? { autoAdded: false, monitorOption: undefined }
      : undefined;
  }
  if (!monitorOption) {
    return { autoAdded: true, monitorOption: firstAvailableMonitorOption };
  }
  return unavailableMonitorOptions.has(monitorOption)
    ? { autoAdded, monitorOption: firstAvailableMonitorOption }
    : undefined;
};

/**
 * Keeps the cowork form's addons valid for the selected tier and day: drops
 * the workstation and includes coffee where the tier doesn't offer them as
 * options, and adds, replaces, or removes a Reserved Desk workstation as the
 * day's requirement changes.
 */
export const useCoworkAddonNormalization = ({
  availability: {
    firstAvailableMonitorOption,
    isSelectionSettled,
    isWorkstationRequired,
    isWorkstationRequirementSettled,
    unavailableMonitorOptions,
  },
  form,
  selection: { date, entryTier, monitorOption },
}: {
  readonly availability: {
    readonly firstAvailableMonitorOption?: WorkspaceProductMonitorOption;
    readonly isSelectionSettled: boolean;
    readonly isWorkstationRequired: boolean;
    readonly isWorkstationRequirementSettled: boolean;
    readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
  };
  readonly form: UseFormReturn<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly selection: CoworkAddonSelection;
}) => {
  const autoAddedWorkstation = useRef(false);
  const isCoffeeOptional = getCoworkTierCoffeeAddon(entryTier) === "optional";
  const isWorkstationOptional =
    getCoworkTierWorkstationAddon(entryTier) === "optional";

  useEffect(() => {
    if (!isWorkstationOptional) {
      autoAddedWorkstation.current = false;
      form.setValue("monitorOption", undefined, { shouldValidate: true });
      if (!isCoffeeOptional) {
        form.setValue("coffee", true, { shouldValidate: true });
      }
      return;
    }
    if (
      !isSelectionSettled ||
      !isWorkstationRequirementSettled ||
      !isReservedDeskSelectionCurrent(form.getValues(), {
        date,
        entryTier,
        monitorOption,
      })
    ) {
      return;
    }

    const normalization = getReservedDeskWorkstationNormalization({
      autoAdded: autoAddedWorkstation.current,
      firstAvailableMonitorOption,
      isRequired: isWorkstationRequired,
      monitorOption,
      unavailableMonitorOptions,
    });
    if (!normalization) return;

    autoAddedWorkstation.current = normalization.autoAdded;
    form.setValue("monitorOption", normalization.monitorOption, {
      shouldValidate: true,
    });
  }, [
    date,
    entryTier,
    firstAvailableMonitorOption,
    form,
    isCoffeeOptional,
    isSelectionSettled,
    isWorkstationOptional,
    isWorkstationRequired,
    isWorkstationRequirementSettled,
    monitorOption,
    unavailableMonitorOptions,
  ]);

  return {
    isCoffeeOptional,
    isWorkstationOptional,
    /** The customer chose the workstation, so the form no longer owns it. */
    onManualWorkstationSelection: () => {
      autoAddedWorkstation.current = false;
    },
    /** Resets the addons a newly chosen tier doesn't offer as options. */
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
