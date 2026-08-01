import { Schema } from "effect";
import {
  type WorkspaceMoney,
  workspaceMoneyFromCurrency,
} from "@/features/checkout/workspace-money";
import { defaultWorkspaceCurrency } from "@/shared/money/currencies";

type WorkspaceMeetingRoomDurationUnit = "day" | "hour";

type WorkspaceMeetingRoomProductDefinition = {
  readonly duration: {
    readonly unit: WorkspaceMeetingRoomDurationUnit;
    readonly amount: number;
  };
  readonly durationSchema: Schema.Top;
  readonly price: WorkspaceMoney;
};

type WorkspaceMeetingRoomDurationKeyFor<
  Product extends WorkspaceMeetingRoomProductDefinition,
> = `${Product["duration"]["unit"]}:${Product["duration"]["amount"]}`;

const defineMeetingRoomProducts = <
  const Products extends Record<string, WorkspaceMeetingRoomProductDefinition>,
>(
  products: Products & {
    readonly [Key in keyof Products]: Key extends WorkspaceMeetingRoomDurationKeyFor<
      Products[Key]
    >
      ? Products[Key]
      : never;
  }
) => products;

const meetingRoomProduct = <
  const Unit extends WorkspaceMeetingRoomDurationUnit,
  const Amount extends number,
>(
  unit: Unit,
  amount: Amount,
  price: WorkspaceMoney
) => ({
  duration: { unit, amount },
  durationSchema: Schema.Struct({
    unit: Schema.Literal(unit),
    amount: Schema.Literal(amount),
  }),
  price,
});

export const workspaceMeetingRoomProductsByDurationKey =
  defineMeetingRoomProducts({
    "hour:1": meetingRoomProduct(
      "hour",
      1,
      workspaceMoneyFromCurrency(47_500, defaultWorkspaceCurrency)
    ),
    "hour:4": meetingRoomProduct(
      "hour",
      4,
      workspaceMoneyFromCurrency(155_000, defaultWorkspaceCurrency)
    ),
    "day:1": meetingRoomProduct(
      "day",
      1,
      workspaceMoneyFromCurrency(232_000, defaultWorkspaceCurrency)
    ),
  });

export type WorkspaceMeetingRoomDurationKey =
  keyof typeof workspaceMeetingRoomProductsByDurationKey;

export const workspaceMeetingRoomCatalog = Object.values(
  workspaceMeetingRoomProductsByDurationKey
);
