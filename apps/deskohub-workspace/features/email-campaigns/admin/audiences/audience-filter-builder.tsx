"use client";

import type { AudienceAttribute } from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { ChevronDown, ListPlus, Plus, X } from "lucide-react";
import { Fragment, useId } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";
import {
  type AudienceFilter,
  viewAudienceCondition,
} from "../../audience-filter";
import type { AudienceValueLookups } from "../audience-filter-summary";
import {
  audienceAttributeMenu,
  isAudienceAttribute,
} from "./audience-attribute-menu";
import {
  audienceAttributeSectionLabel,
  audienceAttributeWording,
} from "./audience-attribute-wording";
import {
  BooleanConditionControls,
  CountConditionControls,
  DateConditionControls,
  SetConditionControls,
} from "./audience-condition-controls";
import {
  FieldError,
  type FieldErrorLookup,
} from "./audience-control-primitives";
import {
  type AudienceCondition,
  type AudienceFilterGroup,
  appendFilter,
  newCondition,
  newNestedGroup,
  removeFilterAt,
  replaceFilterAt,
} from "./audience-filter-editing";

/** Error message React Hook Form holds for a form path, if any. */
export type FilterErrorLookup = (path: string) => string | undefined;

const operatorLabels = {
  and: {
    match: m.emailCampaignsAudienceGroupMatchAll,
    joiner: m.emailCampaignsAudienceGroupJoinAnd,
  },
  or: {
    match: m.emailCampaignsAudienceGroupMatchAny,
    joiner: m.emailCampaignsAudienceGroupJoinOr,
  },
} as const;

const attributeLabel = (attribute: AudienceAttribute, locale: Locale) =>
  audienceAttributeWording(attribute, locale)?.label ?? attribute;

/** Nested groups alternate their accent so each level stands apart. */
const groupFrameClassName = (depth: number) => {
  if (depth === 0) return "border-navy-blue/15 bg-white";
  return depth % 2 === 1
    ? "border-navy-blue/20 border-l-4 border-l-burned-orange/50 bg-navy-blue/[0.03]"
    : "border-navy-blue/20 border-l-4 border-l-navy-blue/40 bg-white";
};

type BuilderContext = {
  readonly errorAt: FilterErrorLookup;
  readonly lookups: AudienceValueLookups;
};

export function AudienceFilterBuilder({
  value,
  onChange,
  path,
  errorAt,
  lookups = {},
}: {
  readonly value: AudienceFilterGroup;
  readonly onChange: (value: AudienceFilterGroup) => void;
  /** Form path of the root group, used to look up validation errors. */
  readonly path: string;
  readonly errorAt: FilterErrorLookup;
  /** Value lists to pick from; a missing one means free entry. */
  readonly lookups?: AudienceValueLookups;
}) {
  return (
    <GroupEditor
      group={value}
      onChange={onChange}
      depth={0}
      path={path}
      context={{ errorAt, lookups }}
    />
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
  path,
  context,
}: {
  readonly group: AudienceFilterGroup;
  readonly onChange: (group: AudienceFilterGroup) => void;
  readonly onRemove?: () => void;
  readonly depth: number;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const replaceAt = (index: number, filter: AudienceFilter) =>
    onChange(replaceFilterAt(group, index, filter));
  const removeAt = (index: number) => onChange(removeFilterAt(group, index));
  const add = (filter: AudienceFilter) => onChange(appendFilter(group, filter));
  const locale = useRouteLocale();
  const groupError =
    context.errorAt(path) ?? context.errorAt(`${path}.filters`);
  const operatorName = useId();

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-2 sm:p-3",
        groupFrameClassName(depth)
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={m.emailCampaignsAudienceGroupCombineLabel({}, { locale })}
          name={operatorName}
          onValueChange={(operator) => onChange({ ...group, operator })}
          options={[
            { label: operatorLabels.and.match({}, { locale }), value: "and" },
            { label: operatorLabels.or.match({}, { locale }), value: "or" },
          ]}
          size="sm"
          value={group.operator}
        />
        <span className="text-navy-blue/60 text-sm">
          {depth === 0
            ? m.emailCampaignsAudienceGroupOfFollowing({}, { locale })
            : m.emailCampaignsAudienceGroupOfThisGroup({}, { locale })}
        </span>
        {onRemove ? (
          <RemoveButton
            label={m.emailCampaignsAudienceGroupRemove({}, { locale })}
            onClick={onRemove}
          />
        ) : null}
      </div>

      {group.filters.length === 0 ? (
        <p className="rounded-md border border-navy-blue/20 border-dashed px-3 py-2 text-navy-blue/60 text-sm">
          {group.operator === "and"
            ? m.emailCampaignsAudienceGroupEmptyAll({}, { locale })
            : m.emailCampaignsAudienceGroupEmptyAny({}, { locale })}
        </p>
      ) : (
        <ol className="space-y-2">
          {group.filters.map((filter, index) => {
            const childPath = `${path}.filters.${index}`;
            return (
              // Nodes are fully controlled and have no identity of their own,
              // so their position is their key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={index} className="space-y-2">
                {index > 0 ? (
                  <span className="block pl-1 font-semibold text-[0.7rem] text-navy-blue/50 uppercase tracking-[0.12em]">
                    {operatorLabels[group.operator].joiner({}, { locale })}
                  </span>
                ) : null}
                {filter._tag === "Group" ? (
                  <GroupEditor
                    group={filter}
                    onChange={(next) => replaceAt(index, next)}
                    onRemove={() => removeAt(index)}
                    depth={depth + 1}
                    path={childPath}
                    context={context}
                  />
                ) : (
                  <ConditionEditor
                    condition={filter}
                    onChange={(next) => replaceAt(index, next)}
                    onRemove={() => removeAt(index)}
                    path={childPath}
                    context={context}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {groupError ? <FieldError message={groupError} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm">
              <Plus className="h-4 w-4" aria-hidden />
              {m.emailCampaignsAudienceGroupAddCondition({}, { locale })}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {audienceAttributeMenu.map(({ section, attributes }, index) => (
              <Fragment key={section}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>
                  {audienceAttributeSectionLabel(section, locale)}
                </DropdownMenuLabel>
                {attributes.map((attribute) => (
                  <DropdownMenuItem
                    key={attribute}
                    onSelect={() => add(newCondition(attribute))}
                  >
                    {attributeLabel(attribute, locale)}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => add(newNestedGroup(group))}
        >
          <ListPlus className="h-4 w-4" aria-hidden />
          {m.emailCampaignsAudienceGroupAddGroup({}, { locale })}
        </Button>
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
  path,
  context,
}: {
  readonly condition: AudienceCondition;
  readonly onChange: (condition: AudienceCondition) => void;
  readonly onRemove: () => void;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const locale = useRouteLocale();
  const errorAt: FieldErrorLookup = (field) =>
    context.errorAt(field === "" ? path : `${path}.${field}`);
  const wording = audienceAttributeWording(condition.attribute, locale);

  const body = Match.value(viewAudienceCondition(condition)).pipe(
    Match.discriminatorsExhaustive("kind")({
      count: ({ entry, condition: count }) =>
        wording?.kind === "count" && (
          <CountConditionControls
            entry={entry}
            wording={wording}
            value={count}
            onChange={onChange}
            errorAt={errorAt}
          />
        ),
      date: ({ entry, condition: date }) =>
        wording?.kind === "date" && (
          <DateConditionControls
            entry={entry}
            wording={wording}
            value={date}
            onChange={onChange}
            errorAt={errorAt}
          />
        ),
      set: ({ entry, condition: set }) =>
        wording?.kind === "set" && (
          <SetConditionControls
            entry={entry}
            wording={wording}
            value={set}
            onChange={onChange}
            errorAt={errorAt}
            path={path}
            lookups={context.lookups}
          />
        ),
      boolean: ({ condition: boolean }) =>
        wording?.kind === "boolean" && (
          <BooleanConditionControls
            wording={wording}
            value={boolean}
            onChange={onChange}
            errorAt={errorAt}
          />
        ),
    })
  );

  return (
    <div className="flex items-start gap-2 rounded-md border border-navy-blue/15 bg-white px-2.5 py-2 sm:gap-3 sm:px-3">
      <div className="min-w-0 flex-1 space-y-2">
        <AttributePicker
          value={condition.attribute}
          onChange={(attribute) => onChange(newCondition(attribute))}
        />
        {body}
        {context.errorAt(path) && (
          <FieldError message={context.errorAt(path) ?? ""} />
        )}
      </div>
      <RemoveButton
        label={m.emailCampaignsAudienceConditionRemove({}, { locale })}
        onClick={onRemove}
      />
    </div>
  );
}

/** Switching the attribute starts its condition over from the defaults. */
function AttributePicker({
  value,
  onChange,
}: {
  readonly value: AudienceAttribute;
  readonly onChange: (attribute: AudienceAttribute) => void;
}) {
  const locale = useRouteLocale();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isAudienceAttribute(next) && next !== value) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label={m.emailCampaignsAudienceConditionAttributeLabel(
          {},
          { locale }
        )}
        className="h-7 min-h-7 w-auto gap-1 rounded-md border-transparent bg-transparent px-1.5 py-0 font-semibold text-[0.7rem] text-navy-blue/65 uppercase tracking-[0.12em] hover:border-navy-blue/20"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {audienceAttributeMenu.map(({ section, attributes }) => (
          <SelectGroup key={section}>
            <SelectLabel>
              {audienceAttributeSectionLabel(section, locale)}
            </SelectLabel>
            {attributes.map((attribute) => (
              <SelectItem key={attribute} value={attribute}>
                {attributeLabel(attribute, locale)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      tone="muted"
      size="icon-sm"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ml-auto shrink-0"
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  );
}
