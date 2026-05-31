import type {
  WorkspaceMoney,
  WorkspaceProductMonitorOption,
  WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";

export type LegalDocumentHash = {
  readonly path: string;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
};

export type CheckoutDetailsJson = {
  readonly schema: "workspace-checkout-details";
  readonly schemaVersion: 1;
  readonly locale: Locale;
  readonly reservation: {
    readonly tier: WorkspaceProductTier;
    readonly date: string;
    readonly coffee: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
    readonly message?: string;
  };
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
    readonly undiscountedPrice?: WorkspaceMoney;
    readonly customerDiscount?: {
      readonly source: "dotypos-discount-group";
      readonly field: string;
      readonly discountGroupId: string;
      readonly percent: number;
      readonly amount: WorkspaceMoney;
    };
  };
  readonly legal: {
    readonly acceptedAt: string;
    readonly documents: {
      readonly termsAndConditions: LegalDocumentHash;
      readonly operatingRules: LegalDocumentHash;
      readonly privacyPolicy: LegalDocumentHash;
    };
    readonly acknowledgements: {
      readonly termsAndConditions: boolean;
      readonly operatingRules: boolean;
      readonly noRefundAfterPinDelivery: boolean;
      readonly privacyPolicy: boolean;
    };
  };
  readonly fulfillment: {
    readonly accessCodePolicy: "workspace-static-v1";
  };
};
