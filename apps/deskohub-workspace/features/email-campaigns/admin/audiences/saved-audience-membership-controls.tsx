"use client";

import {
  AdministrationCampaignAudienceId,
  type InSavedAudienceType as InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { fieldTriggerVariants } from "@/shared/components/ui/field-trigger";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";
import type { AudienceValueOption } from "../audience-filter-summary";
import {
  ConditionLine,
  type ControlProps,
  compactSelectClassName,
  FieldError,
  fieldErrorAttributes,
} from "./audience-control-primitives";
import { unchosenSavedAudience } from "./audience-filter-editing";

const membershipOperators = ["in", "notIn"] as const;

/**
 * "is (not) in saved audience <audience>", picked by name and searchable. A
 * chosen audience missing from the list, such as a deleted one, stays chosen
 * under its own label. The audience counts as it is defined when a run
 * reaches the step, which the note under the line says.
 */
export function SavedAudienceMembershipControls({
  value: condition,
  onChange,
  errorAt,
  savedAudiences,
}: ControlProps<InSavedAudience> & {
  readonly savedAudiences: readonly AudienceValueOption[];
}) {
  const locale = useRouteLocale();
  const missing = errorAt("audienceId") !== undefined;
  const missingErrorId = useId();
  return (
    <div className="flex flex-col gap-2">
      <ConditionLine>
        <Select
          value={condition.operator}
          onValueChange={(next) => {
            const operator = membershipOperators.find(
              (known) => known === next
            );
            if (operator) onChange({ ...condition, operator });
          }}
        >
          <SelectTrigger
            aria-label={m.emailAutomationFlowSavedAudienceOperatorLabel(
              {},
              { locale }
            )}
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {membershipOperators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {m.emailAutomationFlowSavedAudienceOperator(
                  { operator },
                  { locale }
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SavedAudiencePicker
          condition={condition}
          onChange={onChange}
          savedAudiences={savedAudiences}
          missing={missing}
          missingErrorId={missingErrorId}
        />
      </ConditionLine>
      <p className="text-navy-blue/55 text-xs">
        {m.emailAutomationFlowSavedAudienceLiveNote({}, { locale })}
      </p>
      <FieldError
        id={missingErrorId}
        messages={[
          missing
            ? m.emailAutomationFlowSavedAudienceRequired({}, { locale })
            : undefined,
        ]}
      />
    </div>
  );
}

/** The searchable audience picker, marked invalid while none is chosen. */
function SavedAudiencePicker({
  condition,
  onChange,
  savedAudiences,
  missing,
  missingErrorId,
}: {
  readonly condition: InSavedAudience;
  readonly onChange: (condition: InSavedAudience) => void;
  readonly savedAudiences: readonly AudienceValueOption[];
  readonly missing: boolean;
  /** The id of the `FieldError` that says an audience is required. */
  readonly missingErrorId: string;
}) {
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const chosen =
    condition.audienceId === unchosenSavedAudience
      ? undefined
      : condition.audienceId;
  const chosenAudience = savedAudiences.find(({ id }) => id === chosen);
  const search = m.emailAutomationFlowSavedAudienceSearch({}, { locale });
  const unknown = m.emailAutomationFlowSavedAudienceUnknown({}, { locale });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          {...fieldErrorAttributes(missingErrorId, missing)}
          aria-label={m.emailAutomationFlowSavedAudiencePickerLabel(
            {},
            { locale }
          )}
          className={cn(
            fieldTriggerVariants(),
            compactSelectClassName,
            "max-w-72 justify-between",
            missing && "border-burned-orange"
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              chosen === undefined && "text-navy-blue/60"
            )}
          >
            {chosen === undefined
              ? m.emailAutomationFlowSavedAudiencePickerPlaceholder(
                  {},
                  { locale }
                )
              : (chosenAudience?.name ?? unknown)}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-navy-blue/60"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <Command label={search}>
          <CommandInput placeholder={search} />
          <CommandList>
            <SavedAudienceOptions
              savedAudiences={savedAudiences}
              chosen={chosen}
              lost={chosen !== undefined && chosenAudience === undefined}
              unknown={unknown}
              onPick={(audienceId) => {
                onChange({
                  ...condition,
                  audienceId: AdministrationCampaignAudienceId.make(audienceId),
                });
                setOpen(false);
              }}
              onKeep={() => setOpen(false)}
            />
          </CommandList>
          <CommandEmpty>
            {m.emailAutomationFlowSavedAudienceEmpty({}, { locale })}
          </CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The picker's options: the lost chosen audience, then each listed one. */
function SavedAudienceOptions({
  savedAudiences,
  chosen,
  lost,
  unknown,
  onPick,
  onKeep,
}: {
  readonly savedAudiences: readonly AudienceValueOption[];
  readonly chosen: string | undefined;
  /** The chosen audience is missing from the list, such as a deleted one. */
  readonly lost: boolean;
  /** The lost audience's label. */
  readonly unknown: string;
  readonly onPick: (audienceId: string) => void;
  /** Closes the picker on the lost audience, which stays chosen. */
  readonly onKeep: () => void;
}) {
  return (
    <CommandGroup>
      {lost && (
        <CommandItem
          value={chosen}
          keywords={[unknown]}
          selected
          onSelect={onKeep}
        >
          {unknown}
        </CommandItem>
      )}
      {savedAudiences.map((audience) => (
        <CommandItem
          key={audience.id}
          value={audience.id}
          keywords={[audience.name]}
          selected={audience.id === chosen}
          onSelect={() => onPick(audience.id)}
        >
          <span className="min-w-0 flex-1 truncate">{audience.name}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
