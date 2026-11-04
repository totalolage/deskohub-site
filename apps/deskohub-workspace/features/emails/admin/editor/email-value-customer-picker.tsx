"use client";

import { type ReactNode, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { emailValueKindLabel } from "./email-value-kind-label";
import {
  type EmailCustomerFieldOption,
  type EmailCustomerFieldPath,
  emailCustomerFieldOptions,
  emailCustomerFieldPathLabel,
} from "./email-value-options";

const groups = [
  { kind: "scalar", heading: m.emailsEditorValuesGroupScalar },
  { kind: "record", heading: m.emailsEditorValuesGroupRecord },
  { kind: "list", heading: m.emailsEditorValuesGroupList },
] as const satisfies readonly {
  readonly kind: EmailCustomerFieldOption["kind"];
  readonly heading: typeof m.emailsEditorValuesGroupList;
}[];

/** Each kind's fields by path, so related fields sit together in order. */
const fieldsOfKind = (kind: EmailCustomerFieldOption["kind"]) =>
  emailCustomerFieldOptions
    .filter((option) => option.kind === kind)
    .map(({ path }) => ({ path, label: emailCustomerFieldPathLabel(path) }))
    .sort((left, right) => left.label.localeCompare(right.label, "en"));

const fieldsByKind = {
  scalar: fieldsOfKind("scalar"),
  record: fieldsOfKind("record"),
  list: fieldsOfKind("list"),
} as const;

/**
 * A searchable list of every customer field a value can select, grouped by
 * what the field yields. `trigger` renders the button that opens it.
 */
export function EmailValueCustomerPicker({
  onSelect,
  restoresFocusOnSelect = true,
  selectedPath,
  trigger,
}: {
  readonly onSelect: (path: EmailCustomerFieldPath) => void;
  /**
   * Whether choosing a field returns focus to the trigger; turn it off when
   * `onSelect` moves focus itself. Dismissing always returns it.
   */
  readonly restoresFocusOnSelect?: boolean;
  readonly selectedPath?: EmailCustomerFieldPath;
  readonly trigger: (open: boolean) => ReactNode;
}) {
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const selected = selectedPath && emailCustomerFieldPathLabel(selectedPath);
  const search = m.emailsEditorValuesPickerSearch({}, { locale });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger(open)}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (picked.current && !restoresFocusOnSelect) event.preventDefault();
          picked.current = false;
        }}
      >
        <Command label={search}>
          <CommandInput placeholder={search} />
          <CommandList>
            {groups.map(({ kind, heading }) => (
              <CommandGroup
                key={kind}
                heading={heading({}, { locale })}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-navy-blue/55 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]"
              >
                {fieldsByKind[kind].map(({ path, label }) => {
                  return (
                    <CommandItem
                      key={label}
                      value={label}
                      keywords={[label]}
                      selected={label === selected}
                      onSelect={() => {
                        picked.current = true;
                        onSelect(path);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {label}
                      </span>
                      <Badge
                        className="shrink-0 px-1.5 py-0 text-[11px]"
                        variant="subtle"
                      >
                        {emailValueKindLabel(kind, locale)}
                      </Badge>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandEmpty>
            {m.emailsEditorValuesPickerEmpty({}, { locale })}
          </CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
