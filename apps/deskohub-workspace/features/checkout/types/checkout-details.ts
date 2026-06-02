import type { CheckoutSummarySection } from "@/features/checkout/checkout-quote";
import type {
  WorkspaceMoney,
  WorkspaceProductMonitorOption,
  WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import type { legalDocumentKeys } from "../schemas/checkout-details";

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

export type LegalDocumentHash = {
  readonly path: string;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
};

export type LegalEvidence = {
  readonly documentKey: LegalDocumentKey;
  readonly documentHash: string;
  readonly accepted: boolean;
  readonly acceptedAt: string;
  readonly locale: Locale;
  readonly source: string;
  readonly document: LegalDocumentHash;
  readonly acknowledgements?: Record<string, boolean>;
};

export type LegalEvidenceMap = Record<string, LegalEvidence>;

export type CheckoutDetailsJson = {
  readonly schema: "workspace-checkout-details";
  readonly schemaVersion: 1;
  readonly locale: Locale;
  readonly reservation: {
    readonly tier: WorkspaceProductTier;
    readonly date: string;
    readonly coffee: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  };
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
    readonly undiscountedPrice?: WorkspaceMoney;
    readonly quoteFingerprint: string;
    readonly summary: {
      readonly sections: readonly CheckoutSummarySection[];
      readonly total: WorkspaceMoney;
    };
    readonly providerRedirectUrl?: string;
    readonly customerDiscount?: {
      readonly source: "dotypos-discount-group";
      readonly field: string;
      readonly discountGroupId: string;
      readonly percent: number;
      readonly amount: WorkspaceMoney;
    };
  };
  readonly legal: LegalEvidenceMap;
  readonly fulfillment: {
    readonly accessCodePolicy: "workspace-static-v1";
  };
};
