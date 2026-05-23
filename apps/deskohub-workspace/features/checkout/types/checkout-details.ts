export type WorkspaceCheckoutLocale = "cs-CZ" | "en-US";

export type WorkspaceCheckoutTier =
  | "basic-day-pass"
  | "cowork-plus"
  | "profi-workstation";

export type WorkspaceCheckoutMonitorOption = "2x27" | "2x32" | "qhd-4k";

export type LegalDocumentHash = {
  readonly path: string;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
};

export type CheckoutDetailsJson = {
  readonly schema: "workspace-checkout-details";
  readonly schemaVersion: 1;
  readonly locale: WorkspaceCheckoutLocale;
  readonly reservation: {
    readonly tier: WorkspaceCheckoutTier;
    readonly date: string;
    readonly coffee: boolean;
    readonly monitorOption?: WorkspaceCheckoutMonitorOption;
    readonly message?: string;
  };
  readonly payment: {
    readonly expectedAmountMinor: number;
    readonly currency: "CZK";
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
