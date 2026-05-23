import type { WorkspaceLocale } from "@/features/i18n";

export type WorkspaceMoney = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

export const workspaceProductTiers = [
  "basic-day-pass",
  "cowork-plus",
  "profi-workstation",
] as const;

export const workspaceProductMonitorOptions = [
  "2x27",
  "2x32",
  "qhd-4k",
] as const;

export type WorkspaceProductTier = (typeof workspaceProductTiers)[number];
export type WorkspaceProductMonitorOption =
  (typeof workspaceProductMonitorOptions)[number];

export type WorkspaceProductCatalogItem = {
  readonly tier: WorkspaceProductTier;
  readonly tariffId: "basic" | "plus" | "profi";
  readonly productCode:
    | "workspace-basic-day-pass"
    | "workspace-cowork-plus"
    | "workspace-profi-workstation";
  readonly label: string;
  readonly price: WorkspaceMoney;
  readonly includesCourtesyCoffee: boolean;
  readonly requiresCoffee: boolean;
  readonly requiresMonitorOption: boolean;
  readonly allowedMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

export const workspaceProductCatalog = [
  {
    tier: "basic-day-pass",
    tariffId: "basic",
    productCode: "workspace-basic-day-pass",
    label: "Basic Day Pass",
    price: { value: 35_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: false,
    requiresCoffee: false,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  {
    tier: "cowork-plus",
    tariffId: "plus",
    productCode: "workspace-cowork-plus",
    label: "Cowork Plus",
    price: { value: 49_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  {
    tier: "profi-workstation",
    tariffId: "profi",
    productCode: "workspace-profi-workstation",
    label: "Profi Workstation",
    price: { value: 55_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: true,
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
] as const satisfies readonly WorkspaceProductCatalogItem[];

const productsByTier = new Map<
  WorkspaceProductTier,
  WorkspaceProductCatalogItem
>(workspaceProductCatalog.map((product) => [product.tier, product]));

if (productsByTier.size !== workspaceProductTiers.length) {
  throw new Error(
    "Workspace product catalog must cover every reservation tier"
  );
}

export function getWorkspaceProductByTier(tier: WorkspaceProductTier) {
  const product = productsByTier.get(tier);

  if (!product) {
    throw new Error(`Unknown workspace checkout product tier: ${tier}`);
  }

  return product;
}

export function isWorkspaceProductTier(
  value: string | undefined
): value is WorkspaceProductTier {
  return (
    value !== undefined && productsByTier.has(value as WorkspaceProductTier)
  );
}

export function isWorkspaceProductMonitorOption(
  value: string | undefined
): value is WorkspaceProductMonitorOption {
  return (
    value !== undefined &&
    workspaceProductMonitorOptions.includes(
      value as WorkspaceProductMonitorOption
    )
  );
}

export function toWorkspaceMoneyMajorAmount(money: WorkspaceMoney) {
  return money.value / 10 ** money.exponent;
}

export function formatWorkspaceMoney(
  money: WorkspaceMoney,
  locale: WorkspaceLocale
) {
  if (!Number.isInteger(money.exponent) || money.exponent < 0) {
    throw new RangeError(
      "Workspace money exponent must be a non-negative intege"
    );
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: money.exponent,
  }).format(toWorkspaceMoneyMajorAmount(money));
}

export function formatWorkspaceProductCurrencyAmount(
  product: WorkspaceProductCatalogItem,
  locale: WorkspaceLocale
) {
  return formatWorkspaceMoney(product.price, locale);
}
