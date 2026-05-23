import type {
  WorkspaceMoney,
  WorkspaceProductMonitorOption,
  WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import type { WorkspaceLocale } from "@/features/i18n";

export type LegalDocumentHash = {
  readonly path: string;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
};

export type CheckoutDetailsJson = {
  readonly schema: "workspace-checkout-details";
  readonly schemaVersion: 1;
  readonly locale: WorkspaceLocale;
  readonly reservation: {
    readonly tier: WorkspaceProductTier;
    readonly date: string;
    readonly coffee: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
    readonly message?: string;
  };
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
  };
  readonly legal: {
    readonly acceptedAt: string;
    readonly documents: {
      readonly termsAndConditions: LegalDocumentHash;
      readonly operatingRules: LegalDocumentHash;
      readonly privacyPolicy: LegalDocumentHash;
    };
    readonly acknowledgements: {
      readonly operatingRules: true;
      readonly noRefundAfterPinDelivery: true;
      readonly privacyPolicy: true;
    };
  };
  readonly fulfillment: {
    readonly accessCodePolicy: "workspace-static-v1";
  };
};
