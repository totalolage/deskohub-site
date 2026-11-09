"use client";

import type {
  AudienceAttribute,
  AudienceFilterGroupOf,
  AudienceFilterOf,
  AutomationConditionLeaf,
} from "@deskohub/workspace-admin-api";
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
import { viewAudienceCondition } from "../../audience-filter";
import {
  type AudienceFilterHolder,
  canHoldSavedAudienceMembership,
} from "../../audience-filter-usage";
import type {
  AudienceValueLookups,
  AudienceValueOption,
} from "../audience-filter-summary";
import { audienceAttributeMenu } from "./audience-attribute-menu";
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
  fieldErrorAttributes,
} from "./audience-control-primitives";
import {
  type AudienceCondition,
  type AudienceFilterGroup,
  type AudienceFilterLeaf,
  appendFilter,
  newCondition,
  newNestedGroup,
  newSavedAudienceMembership,
  removeFilterAt,
  replaceFilterAt,
} from "./audience-filter-editing";
import { SavedAudienceMembershipControls } from "./saved-audience-membership-controls";

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

type Group = AudienceFilterGroupOf<AudienceFilterLeaf>;
type Filter = AudienceFilterOf<AudienceFilterLeaf>;

type BuilderContext = {
  readonly errorAt: FilterErrorLookup;
  readonly lookups: AudienceValueLookups;
  readonly holder: AudienceFilterHolder;
  readonly savedAudiences: readonly AudienceValueOption[];
};

/** The tree a holder keeps, and how the builder hands edits back. */
type HeldFilter =
  | {
      /** A saved audience by default. */
      readonly holder?: "saved-audience";
      readonly value: AudienceFilterGroup;
      readonly onChange: (value: AudienceFilterGroup) => void;
    }
  | {
      readonly holder: "automation-condition";
      readonly value: AudienceFilterGroupOf<AutomationConditionLeaf>;
      readonly onChange: (
        value: AudienceFilterGroupOf<AutomationConditionLeaf>
      ) => void;
      /** The saved audiences a membership leaf picks from. */
      readonly savedAudiences?: readonly AudienceValueOption[];
    };

/**
 * The AND/OR filter tree editor. What it offers, such as trigger windows,
 * "this campaign", and saved-audience membership, follows what `holder` can
 * hold.
 */
export function AudienceFilterBuilder({
  path,
  errorAt,
  lookups = {},
  ...held
}: HeldFilter & {
  /** Form path of the root group, used to look up validation errors. */
  readonly path: string;
  readonly errorAt: FilterErrorLookup;
  /** Value lists to pick from; a missing one means free entry. */
  readonly lookups?: AudienceValueLookups;
}) {
  const holder = held.holder ?? "saved-audience";
  const savedAudiences =
    held.holder === "automation-condition" ? (held.savedAudiences ?? []) : [];
  return (
    <GroupEditor
      group={held.value}
      // The menus offer only leaves the holder can hold, so a saved
      // audience's edits stay saved-audience filters.
      onChange={held.onChange as (group: Group) => void}
      depth={0}
      path={path}
      context={{ errorAt, lookups, holder, savedAudiences }}
    />
  );
}

/** One leaf the menus can add or switch a condition to. */
type LeafMenuItem = {
  readonly value: string;
  readonly label: string;
  readonly create: () => AudienceFilterLeaf;
};

/** The select value standing for saved-audience membership. */
const savedAudienceMenuValue = "InAudience";

/**
 * The leaves `holder` can hold, by section: its catalogue attributes, then
 * saved-audience membership where it can hold that.
 */
const leafMenu = (
  holder: AudienceFilterHolder,
  locale: Locale
): readonly {
  readonly section: string;
  readonly label: string;
  readonly items: readonly LeafMenuItem[];
}[] => [
  ...audienceAttributeMenu(holder).map(({ section, attributes }) => ({
    section,
    label: audienceAttributeSectionLabel(section, locale),
    items: attributes.map((attribute) => ({
      value: attribute,
      label: attributeLabel(attribute, locale),
      create: () => newCondition(attribute),
    })),
  })),
  ...(canHoldSavedAudienceMembership(holder)
    ? [
        {
          section: savedAudienceMenuValue,
          label: m.emailAutomationFlowSavedAudienceMenuSection({}, { locale }),
          items: [
            {
              value: savedAudienceMenuValue,
              label: m.emailAutomationFlowSavedAudienceMenuLabel(
                {},
                { locale }
              ),
              create: newSavedAudienceMembership,
            },
          ],
        },
      ]
    : []),
];

const leafMenuValue = (leaf: AudienceFilterLeaf) =>
  leaf._tag === "InAudience" ? savedAudienceMenuValue : leaf.attribute;

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
  path,
  context,
}: {
  readonly group: Group;
  readonly onChange: (group: Group) => void;
  readonly onRemove?: () => void;
  readonly depth: number;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const replaceAt = (index: number, filter: Filter) =>
    onChange(replaceFilterAt(group, index, filter));
  const removeAt = (index: number) => onChange(removeFilterAt(group, index));
  const add = (filter: Filter) => onChange(appendFilter(group, filter));
  const locale = useRouteLocale();
  const groupError =
    context.errorAt(path) ?? context.errorAt(`${path}.filters`);
  const operatorName = useId();
  const groupErrorId = useId();

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-2 sm:p-3",
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
                    leaf={filter}
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

      <FieldError id={groupErrorId} messages={[groupError]} />

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-describedby={groupError ? groupErrorId : undefined}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {m.emailCampaignsAudienceGroupAddCondition({}, { locale })}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {leafMenu(context.holder, locale).map(
              ({ section, label, items }, index) => (
                <Fragment key={section}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{label}</DropdownMenuLabel>
                  {items.map((item) => (
                    <DropdownMenuItem
                      key={item.value}
                      onSelect={() => add(item.create())}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </Fragment>
              )
            )}
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
  leaf,
  onChange,
  onRemove,
  path,
  context,
}: {
  readonly leaf: AudienceFilterLeaf;
  readonly onChange: (leaf: AudienceFilterLeaf) => void;
  readonly onRemove: () => void;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const locale = useRouteLocale();
  const errorAt: FieldErrorLookup = (field) =>
    context.errorAt(field === "" ? path : `${path}.${field}`);
  const leafError = context.errorAt(path);
  const leafErrorId = useId();

  return (
    <div className="flex items-start gap-2 rounded-md border border-navy-blue/15 bg-white px-2.5 py-2 sm:gap-3 sm:px-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <LeafPicker
          value={leafMenuValue(leaf)}
          holder={context.holder}
          onChange={onChange}
          errorId={leafErrorId}
          invalid={leafError !== undefined}
        />
        {leaf._tag === "InAudience" ? (
          <SavedAudienceMembershipControls
            value={leaf}
            onChange={onChange}
            errorAt={errorAt}
            savedAudiences={context.savedAudiences}
          />
        ) : (
          <AttributeConditionControls
            condition={leaf}
            onChange={onChange}
            errorAt={errorAt}
            path={path}
            context={context}
          />
        )}
        <FieldError id={leafErrorId} messages={[leafError]} />
      </div>
      <RemoveButton
        label={m.emailCampaignsAudienceConditionRemove({}, { locale })}
        onClick={onRemove}
      />
    </div>
  );
}

/** A catalogue condition's controls, by its attribute's kind. */
function AttributeConditionControls({
  condition,
  onChange,
  errorAt,
  path,
  context,
}: {
  readonly condition: AudienceCondition;
  readonly onChange: (condition: AudienceCondition) => void;
  readonly errorAt: FieldErrorLookup;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const locale = useRouteLocale();
  const wording = audienceAttributeWording(condition.attribute, locale);

  return Match.value(viewAudienceCondition(condition)).pipe(
    Match.discriminatorsExhaustive("kind")({
      count: ({ entry, condition: count }) =>
        wording?.kind === "count" && (
          <CountConditionControls
            entry={entry}
            wording={wording}
            value={count}
            onChange={onChange}
            errorAt={errorAt}
            lookups={context.lookups}
            holder={context.holder}
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
            holder={context.holder}
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
}

/** Switching what a leaf tests starts it over from the defaults. */
function LeafPicker({
  value,
  holder,
  onChange,
  errorId,
  invalid,
}: {
  readonly value: string;
  readonly holder: AudienceFilterHolder;
  readonly onChange: (leaf: AudienceFilterLeaf) => void;
  /** The id of the `FieldError` that explains the condition's own errors. */
  readonly errorId: string;
  readonly invalid: boolean;
}) {
  const locale = useRouteLocale();
  const menu = leafMenu(holder, locale);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const item = menu
          .flatMap(({ items }) => items)
          .find((candidate) => candidate.value === next);
        if (item && next !== value) onChange(item.create());
      }}
    >
      <SelectTrigger
        aria-label={m.emailCampaignsAudienceConditionAttributeLabel(
          {},
          { locale }
        )}
        {...fieldErrorAttributes(errorId, invalid)}
        className="h-7 min-h-7 w-auto gap-1 rounded-md border-transparent bg-transparent px-1.5 py-0 font-semibold text-[0.7rem] text-navy-blue/65 uppercase tracking-[0.12em] hover:border-navy-blue/20"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {menu.map(({ section, label, items }) => (
          <SelectGroup key={section}>
            <SelectLabel>{label}</SelectLabel>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
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
