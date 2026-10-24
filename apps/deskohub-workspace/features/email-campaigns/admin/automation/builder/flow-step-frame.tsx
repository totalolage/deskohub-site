"use client";

import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  Hourglass,
  ListFilter,
  type LucideIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { type ReactNode, type Ref, useRef } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/utils";
import type { InsertableStepKind } from "./automation-flow-editing";

/**
 * One card of the vertical flow (D19): a kind icon, an eyebrow such as
 * "Step 2 · Condition", a title, and an optional menu. The trigger card
 * gets the accent so the flow reads from its start.
 */
export function FlowCard({
  icon: Icon,
  eyebrow,
  title,
  menu,
  accent = false,
  children,
}: {
  readonly icon: LucideIcon;
  readonly eyebrow: string;
  readonly title: string;
  readonly menu?: ReactNode;
  readonly accent?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-white shadow-xs",
        accent
          ? "border-burned-orange/35 border-t-4 border-t-burned-orange"
          : "border-navy-blue/12"
      )}
    >
      <header className="flex items-center gap-3 border-navy-blue/8 border-b px-4 py-3">
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            accent
              ? "bg-burned-orange text-white"
              : "bg-navy-blue/6 text-navy-blue"
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]">
            {eyebrow}
          </p>
          <h3 className="truncate font-semibold text-base text-navy-blue">
            {title}
          </h3>
        </div>
        {menu}
      </header>
      <div className="@container space-y-4 px-4 py-4">{children}</div>
    </article>
  );
}

/**
 * The line between two cards. An insert point sits on it, so steps can be
 * added at any gap; a future branch adds its own connectors the same way.
 */
export function FlowConnector({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="relative flex h-14 items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-navy-blue/15"
      />
      {children && <div className="relative">{children}</div>}
    </div>
  );
}

const insertableSteps = {
  Condition: {
    icon: ListFilter,
    label: m.emailAutomationFlowInsertCondition,
    description: m.emailAutomationFlowInsertConditionDescription,
  },
  Wait: {
    icon: Hourglass,
    label: m.emailAutomationFlowInsertWait,
    description: m.emailAutomationFlowInsertWaitDescription,
  },
} as const satisfies Record<
  InsertableStepKind,
  {
    readonly icon: LucideIcon;
    readonly label: typeof m.emailAutomationFlowInsertCondition;
    readonly description: typeof m.emailAutomationFlowInsertConditionDescription;
  }
>;

/** The round "+" on a connector, offering each step kind with a hint. */
export function InsertStepMenu({
  position,
  onInsert,
  triggerRef,
}: {
  /** The number the new step gets, for its accessible name. */
  readonly position: number;
  readonly onInsert: (kind: InsertableStepKind) => void;
  readonly triggerRef?: Ref<HTMLButtonElement>;
}) {
  const locale = useRouteLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="secondary"
          size="icon-sm"
          shape="pill"
          aria-label={m.emailAutomationFlowInsertLabel(
            { position },
            { locale }
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        {(
          Object.entries(insertableSteps) as [
            InsertableStepKind,
            (typeof insertableSteps)[InsertableStepKind],
          ][]
        ).map(([kind, { icon: Icon, label, description }]) => (
          <DropdownMenuItem
            key={kind}
            onSelect={() => onInsert(kind)}
            className="items-start gap-3 py-2.5"
          >
            <span
              aria-hidden
              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-navy-blue/6"
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-sm">
                {label({}, { locale })}
              </span>
              <span className="block text-navy-blue/60 text-xs leading-5">
                {description({}, { locale })}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A step card's overflow menu: move it within the path, or delete it. */
export function StepMenu({
  stepLabel,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  onDeleted,
}: {
  readonly stepLabel: string;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onDelete: () => void;
  /**
   * Moves focus once the menu has closed after Delete: its trigger left with
   * the deleted step, so the menu can't return focus there.
   */
  readonly onDeleted: () => void;
}) {
  const locale = useRouteLocale();
  const deleted = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          tone="muted"
          size="icon-sm"
          aria-label={m.emailAutomationFlowStepMenuLabel(
            { step: stepLabel },
            { locale }
          )}
        >
          <Ellipsis className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!deleted.current) return;
          event.preventDefault();
          onDeleted();
        }}
      >
        <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
          <ArrowUp className="h-4 w-4" aria-hidden />
          {m.emailAutomationFlowStepMoveUp({}, { locale })}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
          <ArrowDown className="h-4 w-4" aria-hidden />
          {m.emailAutomationFlowStepMoveDown({}, { locale })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            deleted.current = true;
            onDelete();
          }}
          className="text-red-700 focus:text-red-800"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {m.emailAutomationFlowStepDelete({}, { locale })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
