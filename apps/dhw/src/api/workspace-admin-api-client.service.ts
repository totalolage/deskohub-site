import {
  type AdminCliInfoType,
  type AdministrationAccountIdType,
  type AdministrationAdministratorGrantInputType,
  type AdministrationAdministratorGrantResultType,
  type AdministrationAdministratorListType,
  type AdministrationAdministratorRevocationResultType,
  type AdministrationBookingDetailType,
  type AdministrationBookingPageType,
  type AdministrationBookingQueryType,
  type AdministrationCampaignAudienceIdType,
  type AdministrationCampaignAudienceInputType,
  type AdministrationCampaignAudienceType,
  type AdministrationCampaignAudienceUpdateType,
  type AdministrationCampaignCreateInputType,
  type AdministrationCampaignDetailType,
  type AdministrationCampaignEmailPreviewType,
  type AdministrationCampaignIdType,
  type AdministrationCampaignRecipientPreviewType,
  type AdministrationCampaignRetryInputType,
  type AdministrationCampaignRetryResultType,
  type AdministrationCampaignSendInputType,
  type AdministrationCampaignSendResultType,
  type AdministrationCampaignSendStatusResultType,
  type AdministrationCampaignSettingsType,
  type AdministrationCampaignSummaryType,
  type AdministrationCampaignTemplateKeyType,
  type AdministrationCampaignTemplatePreviewInputType,
  type AdministrationCampaignTemplateType,
  type AdministrationCampaignTestSendInputType,
  type AdministrationCampaignTestSendResultType,
  type AdministrationCampaignUpdateInputType,
  type AdministrationCustomerDetailType,
  type AdministrationCustomerPageType,
  type AdministrationCustomerQueryType,
  type AdministrationCustomerReservationActivityType,
  type AdministrationCustomerReservationPageType,
  type AdministrationCustomerReservationsQueryType,
  type AdministrationCustomerSearchQueryType,
  type AdministrationCustomerSearchResultType,
  type AdministrationDiscountCodeDetailType,
  type AdministrationDiscountCodeIdType,
  type AdministrationDiscountDashboardType,
  type AdministrationDiscountGroupListType,
  type AdministrationDiscountMutationResultType,
  type AdministrationDiscountMutationType,
  type AdministrationDotyposCustomerIdType,
  type AdministrationDotyposReservationIdType,
  type AdministrationInvoiceCreateInputType,
  type AdministrationInvoiceCreateResultType,
  type AdministrationInvoiceCreationDefaultsType,
  type AdministrationInvoiceDetailType,
  type AdministrationInvoiceIdType,
  type AdministrationInvoicePageType,
  type AdministrationInvoiceQueryType,
  type AdministrationInvoiceRetryResultType,
  type AdministrationLegacyAdministratorBackfillInputType,
  type AdministrationLegacyAdministratorBackfillResultType,
  type AdministrationNexiOperationIdType,
  type AdministrationNexiOrderIdType,
  type AdministrationOperationDetailType,
  type AdministrationOperationListType,
  type AdministrationOperationQueryType,
  type AdministrationOrderListType,
  type AdministrationOrderQueryType,
  type AdministrationOrderType,
  type AdministrationOverviewType,
  type AdministrationReservationAccessGrantType,
  type AdministrationReservationAccessMutationType,
  type AdministrationReservationActivityType,
  type AdministrationReservationCancellationInputType,
  type AdministrationReservationCancellationResultType,
  type AdministrationReservationDetailType,
  type AdministrationReservationLookupResultType,
  type AdministrationReservationPageType,
  type AdministrationReservationProductDetailsBackfillBatchType,
  type AdministrationReservationProductDetailsBackfillInputType,
  type AdministrationReservationQueryType,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCreateInputType,
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  type AdministrationVoucherDetailType,
  type AdministrationVoucherIdType,
  type AdministrationWorkspaceReservationIdType,
  type AutomationActivateInputType,
  type AutomationDetailType,
  type AutomationDryRunType,
  type AutomationEngineHealthType,
  type AutomationFlowUpdateType,
  type AutomationPreviewRefType,
  type AutomationPreviewStatusType,
  type AutomationRunDetailType,
  type AutomationRunListInputType,
  type AutomationRunPageType,
  type AutomationRunRefType,
  type AutomationRunStatsInputType,
  type AutomationRunStatsType,
  type AutomationVersionDetailType,
  type AutomationVersionRefType,
  type AutomationVersionSummaryType,
  type CalendarPreviewInputType,
  type CalendarPreviewType,
  type CliAccessTokenType,
  type CliAuthenticationCodeType,
  CliAuthenticationRateLimited,
  type CliAuthenticationStatusType,
  CliGrantRejected,
  CliInputInvalid,
  CliMutationInProgress,
  CliMutationRejected,
  type CliMutationRequestIdType,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  type CliSessionAdministrationType,
  type CliSessionIdType,
  type CliSessionMutationResultType,
  type CliSessionType,
  CliSessionUnauthorized,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  dhwVersionHeader,
  type ExchangeCliGrantType,
  type GrantedCliSessionType,
  type RenameCliSessionType,
  type StartCliAuthenticationType,
  type StartedCliAuthenticationType,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Redacted,
  Schedule,
  type Schema,
} from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { DHW_VERSION } from "../build-info";
import { DhwConfig } from "../config/dhw-config.service";

interface IWorkspaceAdminApiClient {
  readonly getInfo: Effect.Effect<
    AdminCliInfoType,
    HttpClientError.HttpClientError | Schema.SchemaError
  >;
  readonly startAuthentication: (
    input: StartCliAuthenticationType
  ) => Effect.Effect<
    StartedCliAuthenticationType,
    CliApiRequestError | CliAuthenticationRateLimited | CliServiceUnavailable
  >;
  readonly getAuthenticationStatus: (
    code: CliAuthenticationCodeType
  ) => Effect.Effect<
    CliAuthenticationStatusType,
    CliApiRequestError | CliServiceUnavailable
  >;
  readonly exchangeGrant: (
    input: ExchangeCliGrantType
  ) => Effect.Effect<
    GrantedCliSessionType,
    CliApiRequestError | CliGrantRejected | CliServiceUnavailable
  >;
  readonly getCurrentSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    CliSessionType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOverview: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationOverviewType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getReservationActivity: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationReservationActivityType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listReservations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationReservationQueryType
  ) => Effect.Effect<
    AdministrationReservationPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    reservationId: AdministrationWorkspaceReservationIdType
  ) => Effect.Effect<
    AdministrationReservationDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly backfillReservationProductDetails: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationReservationProductDetailsBackfillInputType
  ) => Effect.Effect<
    AdministrationReservationProductDetailsBackfillBatchType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listAdministrators: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationAdministratorListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly grantAdministrator: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationAdministratorGrantInputType
  ) => Effect.Effect<
    AdministrationAdministratorGrantResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly revokeAdministrator: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    accountId: AdministrationAccountIdType
  ) => Effect.Effect<
    AdministrationAdministratorRevocationResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly backfillLegacyAdministrator: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationLegacyAdministratorBackfillInputType
  ) => Effect.Effect<
    AdministrationLegacyAdministratorBackfillResultType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly cancelReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    reservationId: AdministrationWorkspaceReservationIdType,
    input: AdministrationReservationCancellationInputType
  ) => Effect.Effect<
    AdministrationReservationCancellationResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly mutateReservationAccess: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    reservationId: AdministrationWorkspaceReservationIdType,
    mutation: AdministrationReservationAccessMutationType
  ) => Effect.Effect<
    AdministrationReservationAccessGrantType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly findReservation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    identifier: string
  ) => Effect.Effect<
    AdministrationReservationLookupResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listBookings: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationBookingQueryType
  ) => Effect.Effect<
    AdministrationBookingPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getBooking: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    bookingId: AdministrationDotyposReservationIdType
  ) => Effect.Effect<
    AdministrationBookingDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listOrders: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationOrderQueryType
  ) => Effect.Effect<
    AdministrationOrderListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOrder: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    orderId: AdministrationNexiOrderIdType
  ) => Effect.Effect<
    AdministrationOrderType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listOperations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationOperationQueryType
  ) => Effect.Effect<
    AdministrationOperationListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getOperation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    operationId: AdministrationNexiOperationIdType
  ) => Effect.Effect<
    AdministrationOperationDetailType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCustomers: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationCustomerQueryType
  ) => Effect.Effect<
    AdministrationCustomerPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly searchCustomers: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationCustomerSearchQueryType
  ) => Effect.Effect<
    AdministrationCustomerSearchResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getCustomer: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: AdministrationDotyposCustomerIdType
  ) => Effect.Effect<
    AdministrationCustomerDetailType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getCustomerReservationActivity: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: AdministrationDotyposCustomerIdType
  ) => Effect.Effect<
    AdministrationCustomerReservationActivityType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCustomerReservations: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    customerId: AdministrationDotyposCustomerIdType,
    query: AdministrationCustomerReservationsQueryType
  ) => Effect.Effect<
    AdministrationCustomerReservationPageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getDiscountDashboard: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationDiscountDashboardType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listDiscountGroups: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationDiscountGroupListType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getDiscountCode: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    codeId: AdministrationDiscountCodeIdType
  ) => Effect.Effect<
    AdministrationDiscountCodeDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly getVoucher: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    voucherId: AdministrationVoucherIdType
  ) => Effect.Effect<
    AdministrationVoucherDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listInvoices: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    query: AdministrationInvoiceQueryType
  ) => Effect.Effect<
    AdministrationInvoicePageType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly getInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    AdministrationInvoiceDetailType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly getInvoicePdf: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    Uint8Array,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly getInvoiceCreationDefaults: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    AdministrationInvoiceCreationDefaultsType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly previewInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationInvoiceCreateInputType
  ) => Effect.Effect<
    Uint8Array,
    | CliApiRequestError
    | CliMutationRejected
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly createInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AdministrationInvoiceCreateInputType
  ) => Effect.Effect<
    AdministrationInvoiceCreateResultType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly resendInvoice: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<
    AdministrationInvoiceRetryResultType,
    | CliApiRequestError
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly createStandaloneAccessCode: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    attemptId: AdministrationStandaloneAccessCodeAttemptIdType,
    input: AdministrationStandaloneAccessCodeCreateInputType,
    providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType
  ) => Effect.Effect<
    AdministrationStandaloneAccessCodeCreationOutcomeType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliMutationUncertain
    | CliStandaloneAccessCodeCleanupRequired
    | CliStandaloneAccessCodeReconciled
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly listSessions: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    ReadonlyArray<CliSessionAdministrationType>,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly mutateDiscounts: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    input: AdministrationDiscountMutationType
  ) => Effect.Effect<
    AdministrationDiscountMutationResultType,
    | CliApiRequestError
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly renameSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    sessionId: CliSessionIdType,
    input: RenameCliSessionType
  ) => Effect.Effect<
    CliSessionMutationResultType,
    | CliApiRequestError
    | CliResourceNotFound
    | CliSessionUnauthorized
    | CliServiceUnavailable
  >;
  readonly revokeSession: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    sessionId: CliSessionIdType
  ) => Effect.Effect<
    CliSessionMutationResultType,
    CliApiRequestError | CliSessionUnauthorized | CliServiceUnavailable
  >;
  readonly listCampaignAudiences: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    ReadonlyArray<AdministrationCampaignAudienceType>,
    CampaignRequestError
  >;
  readonly getCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    audienceId: AdministrationCampaignAudienceIdType
  ) => Effect.Effect<AdministrationCampaignAudienceType, CampaignRequestError>;
  /** Retries under `requestId` replay the first creation. */
  readonly createCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    input: AdministrationCampaignAudienceInputType
  ) => Effect.Effect<AdministrationCampaignAudienceType, CampaignRequestError>;
  readonly updateCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    audienceId: AdministrationCampaignAudienceIdType,
    input: AdministrationCampaignAudienceUpdateType
  ) => Effect.Effect<AdministrationCampaignAudienceType, CampaignRequestError>;
  readonly archiveCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    audienceId: AdministrationCampaignAudienceIdType
  ) => Effect.Effect<AdministrationCampaignAudienceType, CampaignRequestError>;
  readonly unarchiveCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    audienceId: AdministrationCampaignAudienceIdType
  ) => Effect.Effect<AdministrationCampaignAudienceType, CampaignRequestError>;
  readonly deleteCampaignAudience: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    audienceId: AdministrationCampaignAudienceIdType
  ) => Effect.Effect<
    { readonly id: AdministrationCampaignAudienceIdType },
    CampaignRequestError
  >;
  readonly listCampaignTemplates: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    ReadonlyArray<AdministrationCampaignTemplateType>,
    CampaignRequestError
  >;
  readonly getCampaignSettings: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<AdministrationCampaignSettingsType, CampaignRequestError>;
  readonly previewCampaignTemplate: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    templateKey: AdministrationCampaignTemplateKeyType,
    input: AdministrationCampaignTemplatePreviewInputType
  ) => Effect.Effect<
    AdministrationCampaignEmailPreviewType,
    CampaignRequestError
  >;
  readonly listCampaigns: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<
    ReadonlyArray<AdministrationCampaignSummaryType>,
    CampaignRequestError
  >;
  readonly getCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AdministrationCampaignDetailType, CampaignRequestError>;
  /** Retries under `requestId` replay the first creation. */
  readonly createCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    input: AdministrationCampaignCreateInputType
  ) => Effect.Effect<AdministrationCampaignDetailType, CampaignRequestError>;
  readonly updateCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType,
    input: AdministrationCampaignUpdateInputType
  ) => Effect.Effect<AdministrationCampaignDetailType, CampaignRequestError>;
  /** Retries under `requestId` replay the first duplication. */
  readonly duplicateCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    requestId: CliMutationRequestIdType,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AdministrationCampaignDetailType, CampaignRequestError>;
  readonly deleteCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<
    { readonly id: AdministrationCampaignIdType },
    CampaignRequestError
  >;
  readonly previewCampaignRecipients: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<
    AdministrationCampaignRecipientPreviewType,
    CampaignRequestError
  >;
  readonly testSendCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType,
    input: AdministrationCampaignTestSendInputType
  ) => Effect.Effect<
    AdministrationCampaignTestSendResultType,
    CampaignRequestError
  >;
  readonly sendCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType,
    input: AdministrationCampaignSendInputType
  ) => Effect.Effect<
    AdministrationCampaignSendResultType,
    CampaignRequestError
  >;
  readonly retryCampaign: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType,
    input: AdministrationCampaignRetryInputType
  ) => Effect.Effect<
    AdministrationCampaignRetryResultType,
    CampaignRequestError
  >;
  readonly getCampaignSendStatus: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<
    AdministrationCampaignSendStatusResultType,
    CampaignRequestError
  >;
  readonly getAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AutomationDetailType, CampaignRequestError>;
  readonly updateAutomationFlow: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationFlowUpdateType
  ) => Effect.Effect<AutomationDetailType, CampaignRequestError>;
  readonly dryRunAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AutomationPreviewStatusType, CampaignRequestError>;
  readonly getAutomationDryRun: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationPreviewRefType
  ) => Effect.Effect<AutomationDryRunType, CampaignRequestError>;
  readonly activateAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationActivateInputType
  ) => Effect.Effect<AutomationVersionSummaryType, CampaignRequestError>;
  readonly pauseAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AutomationDetailType, CampaignRequestError>;
  readonly resumeAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AutomationDetailType, CampaignRequestError>;
  readonly archiveAutomation: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<AutomationDetailType, CampaignRequestError>;
  readonly listAutomationVersions: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    campaignId: AdministrationCampaignIdType
  ) => Effect.Effect<
    ReadonlyArray<AutomationVersionSummaryType>,
    CampaignRequestError
  >;
  readonly getAutomationVersion: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationVersionRefType
  ) => Effect.Effect<AutomationVersionDetailType, CampaignRequestError>;
  readonly getAutomationRunStats: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationRunStatsInputType
  ) => Effect.Effect<AutomationRunStatsType, CampaignRequestError>;
  readonly listAutomationRuns: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationRunListInputType
  ) => Effect.Effect<AutomationRunPageType, CampaignRequestError>;
  readonly getAutomationRun: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: AutomationRunRefType
  ) => Effect.Effect<AutomationRunDetailType, CampaignRequestError>;
  readonly previewCalendarExpression: (
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    input: CalendarPreviewInputType
  ) => Effect.Effect<CalendarPreviewType, CampaignRequestError>;
  readonly getAutomationEngineHealth: (
    accessToken: Redacted.Redacted<CliAccessTokenType>
  ) => Effect.Effect<AutomationEngineHealthType, CampaignRequestError>;
}

/** Every campaign endpoint reports these; input and state messages are user-facing. */
type CampaignRequestError =
  | CliApiRequestError
  | CliInputInvalid
  | CliMutationInProgress
  | CliMutationRejected
  | CliResourceNotFound
  | CliSessionUnauthorized
  | CliServiceUnavailable;

export class WorkspaceAdminApiClient extends Context.Service<
  WorkspaceAdminApiClient,
  IWorkspaceAdminApiClient
>()("WorkspaceAdminApiClient") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => makeWorkspaceAdminApiClient)
  );
}

const makeWorkspaceAdminApiClient = Effect.gen(function* () {
  const config = yield* DhwConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const requestHeaders = Object.fromEntries(
    Object.entries(config.requestHeaders).map(([name, value]) => [
      name,
      Redacted.value(value),
    ])
  );
  const makeClient = (accessToken?: Redacted.Redacted<CliAccessTokenType>) =>
    HttpApiClient.make(WorkspaceAdminApi, {
      baseUrl: config.baseUrl,
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.setHeaders({
          ...requestHeaders,
          [dhwVersionHeader]: DHW_VERSION,
          ...(accessToken && {
            authorization: `Bearer ${Redacted.value(accessToken)}`,
          }),
        })
      ),
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
  const client = yield* makeClient();

  return {
    getInfo: client.cli
      .getInfo({})
      .pipe(Effect.withSpan("WorkspaceAdminApiClient.getInfo")),
    startAuthentication: Effect.fn(
      "WorkspaceAdminApiClient.startAuthentication"
    )((input: StartCliAuthenticationType) =>
      client.cli
        .startAuthentication({ payload: input })
        .pipe(Effect.mapError(sanitizeStartError))
    ),
    getAuthenticationStatus: Effect.fn(
      "WorkspaceAdminApiClient.getAuthenticationStatus"
    )((code: CliAuthenticationCodeType) =>
      client.cli
        .getAuthenticationStatus({ query: { code } })
        .pipe(Effect.mapError(sanitizeRequestError))
    ),
    exchangeGrant: Effect.fn("WorkspaceAdminApiClient.exchangeGrant")(
      (input: ExchangeCliGrantType) =>
        client.cli
          .exchangeGrant({ payload: input })
          .pipe(Effect.mapError(sanitizeGrantError))
    ),
    getCurrentSession: Effect.fn("WorkspaceAdminApiClient.getCurrentSession")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) => authorized.cli.getCurrentSession({})),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOverview: Effect.fn("WorkspaceAdminApiClient.getOverview")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOverview({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getReservationActivity: Effect.fn(
      "WorkspaceAdminApiClient.getReservationActivity"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.getReservationActivity({})
        ),
        Effect.mapError(sanitizeSessionError)
      )
    ),
    listReservations: Effect.fn("WorkspaceAdminApiClient.listReservations")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationReservationQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listReservations({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getReservation: Effect.fn("WorkspaceAdminApiClient.getReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        reservationId: AdministrationWorkspaceReservationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getReservation({
              params: { reservationId },
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    mutateReservationAccess: Effect.fn(
      "WorkspaceAdminApiClient.mutateReservationAccess"
    )((accessToken, requestId, reservationId, mutation) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.mutateReservationAccess({
            params: { reservationId },
            payload: { requestId, mutation },
          })
        ),
        retryLedgerMutation(20),
        Effect.mapError(sanitizeMutationError)
      )
    ),
    findReservation: Effect.fn("WorkspaceAdminApiClient.findReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        identifier: string
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.findReservation({
              query: { identifier },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listBookings: Effect.fn("WorkspaceAdminApiClient.listBookings")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationBookingQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listBookings({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getBooking: Effect.fn("WorkspaceAdminApiClient.getBooking")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        bookingId: AdministrationDotyposReservationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getBooking({ params: { bookingId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    listOrders: Effect.fn("WorkspaceAdminApiClient.listOrders")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationOrderQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listOrders({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOrder: Effect.fn("WorkspaceAdminApiClient.getOrder")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        orderId: AdministrationNexiOrderIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOrder({ params: { orderId } })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listOperations: Effect.fn("WorkspaceAdminApiClient.listOperations")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationOperationQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listOperations({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getOperation: Effect.fn("WorkspaceAdminApiClient.getOperation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        operationId: AdministrationNexiOperationIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getOperation({
              params: { operationId },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listCustomers: Effect.fn("WorkspaceAdminApiClient.listCustomers")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationCustomerQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listCustomers({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    searchCustomers: Effect.fn("WorkspaceAdminApiClient.searchCustomers")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationCustomerSearchQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.searchCustomers({ query })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getCustomer: Effect.fn("WorkspaceAdminApiClient.getCustomer")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        customerId: AdministrationDotyposCustomerIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getCustomer({ params: { customerId } })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getCustomerReservationActivity: Effect.fn(
      "WorkspaceAdminApiClient.getCustomerReservationActivity"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        customerId: AdministrationDotyposCustomerIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getCustomerReservationActivity({
              params: { customerId },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listCustomerReservations: Effect.fn(
      "WorkspaceAdminApiClient.listCustomerReservations"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        customerId: AdministrationDotyposCustomerIdType,
        query: AdministrationCustomerReservationsQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listCustomerReservations({
              params: { customerId },
              query,
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    getDiscountDashboard: Effect.fn(
      "WorkspaceAdminApiClient.getDiscountDashboard"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.getDiscountDashboard({})
        ),
        Effect.mapError(sanitizeSessionError)
      )
    ),
    listDiscountGroups: Effect.fn("WorkspaceAdminApiClient.listDiscountGroups")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listDiscountGroups({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    backfillReservationProductDetails: Effect.fn(
      "WorkspaceAdminApiClient.backfillReservationProductDetails"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: AdministrationReservationProductDetailsBackfillInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.backfillReservationProductDetails({
              payload: input,
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listAdministrators: Effect.fn("WorkspaceAdminApiClient.listAdministrators")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administrators.listAdministrators({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    grantAdministrator: Effect.fn("WorkspaceAdminApiClient.grantAdministrator")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: AdministrationAdministratorGrantInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administrators.grantAdministrator({ payload: input })
          ),
          Effect.mapError(sanitizeRejectedResourceError)
        )
    ),
    revokeAdministrator: Effect.fn(
      "WorkspaceAdminApiClient.revokeAdministrator"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        accountId: AdministrationAccountIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administrators.revokeAdministrator({
              params: { accountId },
            })
          ),
          Effect.mapError(sanitizeRejectedError)
        )
    ),
    backfillLegacyAdministrator: Effect.fn(
      "WorkspaceAdminApiClient.backfillLegacyAdministrator"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: AdministrationLegacyAdministratorBackfillInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administrators.backfillLegacyAdministrator({
              payload: input,
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    cancelReservation: Effect.fn("WorkspaceAdminApiClient.cancelReservation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        reservationId: AdministrationWorkspaceReservationIdType,
        input: AdministrationReservationCancellationInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.cancelReservation({
              params: { reservationId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeRejectedResourceError)
        )
    ),
    getDiscountCode: Effect.fn("WorkspaceAdminApiClient.getDiscountCode")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        codeId: AdministrationDiscountCodeIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getDiscountCode({ params: { codeId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    getVoucher: Effect.fn("WorkspaceAdminApiClient.getVoucher")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        voucherId: AdministrationVoucherIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getVoucher({ params: { voucherId } })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    listInvoices: Effect.fn("WorkspaceAdminApiClient.listInvoices")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        query: AdministrationInvoiceQueryType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listInvoices({ query })
          ),
          Effect.mapError(sanitizeInvoiceListError)
        )
    ),
    getInvoice: Effect.fn("WorkspaceAdminApiClient.getInvoice")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        invoiceId: AdministrationInvoiceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getInvoice({ params: { invoiceId } })
          ),
          Effect.mapError(sanitizeInvoiceError)
        )
    ),
    getInvoicePdf: Effect.fn("WorkspaceAdminApiClient.getInvoicePdf")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        invoiceId: AdministrationInvoiceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.getInvoicePdf({
              params: { invoiceId },
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    getInvoiceCreationDefaults: Effect.fn(
      "WorkspaceAdminApiClient.getInvoiceCreationDefaults"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.administration.getInvoiceCreationDefaults({})
        ),
        Effect.mapError(sanitizeSessionError)
      )
    ),
    previewInvoice: Effect.fn("WorkspaceAdminApiClient.previewInvoice")(
      (accessToken, input: AdministrationInvoiceCreateInputType) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.previewInvoice({ payload: input })
          ),
          Effect.mapError(sanitizeRejectedError)
        )
    ),
    createInvoice: Effect.fn("WorkspaceAdminApiClient.createInvoice")(
      (accessToken, input: AdministrationInvoiceCreateInputType) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.createInvoice({ payload: input })
          ),
          retryLedgerMutation(240),
          Effect.mapError(sanitizeInvoiceCreationError)
        )
    ),
    resendInvoice: Effect.fn("WorkspaceAdminApiClient.resendInvoice")(
      (accessToken, invoiceId: AdministrationInvoiceIdType) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.resendInvoice({
              params: { invoiceId },
            })
          ),
          Effect.mapError(sanitizeRejectedResourceError)
        )
    ),
    createStandaloneAccessCode: Effect.fn(
      "WorkspaceAdminApiClient.createStandaloneAccessCode"
    )(
      (
        accessToken,
        attemptId: AdministrationStandaloneAccessCodeAttemptIdType,
        input: AdministrationStandaloneAccessCodeCreateInputType,
        providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.createStandaloneAccessCode({
              payload: {
                attemptId,
                input,
                ...(providerCredentialRemovedAttemptId && {
                  providerCredentialRemovedAttemptId,
                }),
              },
            })
          ),
          retryLedgerMutation(240),
          Effect.mapError(sanitizeAccessCodeCreationError)
        )
    ),
    listSessions: Effect.fn("WorkspaceAdminApiClient.listSessions")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.listSessions({})
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    mutateDiscounts: Effect.fn("WorkspaceAdminApiClient.mutateDiscounts")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        requestId: CliMutationRequestIdType,
        input: AdministrationDiscountMutationType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.mutateDiscounts({
              payload: { requestId, mutation: input },
            })
          ),
          retryLedgerMutation(20),
          Effect.mapError(sanitizeMutationError)
        )
    ),
    renameSession: Effect.fn("WorkspaceAdminApiClient.renameSession")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        sessionId: CliSessionIdType,
        input: RenameCliSessionType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.renameSession({
              params: { sessionId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeResourceError)
        )
    ),
    revokeSession: Effect.fn("WorkspaceAdminApiClient.revokeSession")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        sessionId: CliSessionIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.administration.revokeSession({
              params: { sessionId },
            })
          ),
          Effect.mapError(sanitizeSessionError)
        )
    ),
    listCampaignAudiences: Effect.fn(
      "WorkspaceAdminApiClient.listCampaignAudiences"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.campaigns.listCampaignAudiences({})
        ),
        Effect.mapError(sanitizeCampaignError)
      )
    ),
    getCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.getCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        audienceId: AdministrationCampaignAudienceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.getCampaignAudience({ params: { audienceId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    createCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.createCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        requestId: CliMutationRequestIdType,
        input: AdministrationCampaignAudienceInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.createCampaignAudience({
              payload: { requestId, audience: input },
            })
          ),
          retryLedgerMutation(20),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    updateCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.updateCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        audienceId: AdministrationCampaignAudienceIdType,
        input: AdministrationCampaignAudienceUpdateType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.updateCampaignAudience({
              params: { audienceId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    archiveCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.archiveCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        audienceId: AdministrationCampaignAudienceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.archiveCampaignAudience({
              params: { audienceId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    unarchiveCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.unarchiveCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        audienceId: AdministrationCampaignAudienceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.unarchiveCampaignAudience({
              params: { audienceId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    deleteCampaignAudience: Effect.fn(
      "WorkspaceAdminApiClient.deleteCampaignAudience"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        audienceId: AdministrationCampaignAudienceIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.deleteCampaignAudience({
              params: { audienceId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    listCampaignTemplates: Effect.fn(
      "WorkspaceAdminApiClient.listCampaignTemplates"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.campaigns.listCampaignTemplates({})
        ),
        Effect.mapError(sanitizeCampaignError)
      )
    ),
    getCampaignSettings: Effect.fn(
      "WorkspaceAdminApiClient.getCampaignSettings"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.campaigns.getCampaignSettings({})
        ),
        Effect.mapError(sanitizeCampaignError)
      )
    ),
    previewCampaignTemplate: Effect.fn(
      "WorkspaceAdminApiClient.previewCampaignTemplate"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        templateKey: AdministrationCampaignTemplateKeyType,
        input: AdministrationCampaignTemplatePreviewInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            // The client takes one request shape per payload variant.
            Match.valueTags(input, {
              Content: (payload) =>
                authorized.campaigns.previewCampaignTemplate({
                  params: { templateKey },
                  payload,
                }),
              UnfinishedContent: (payload) =>
                authorized.campaigns.previewCampaignTemplate({
                  params: { templateKey },
                  payload,
                }),
              Campaign: (payload) =>
                authorized.campaigns.previewCampaignTemplate({
                  params: { templateKey },
                  payload,
                }),
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    listCampaigns: Effect.fn("WorkspaceAdminApiClient.listCampaigns")(
      (accessToken: Redacted.Redacted<CliAccessTokenType>) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.listCampaigns({})
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getCampaign: Effect.fn("WorkspaceAdminApiClient.getCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.getCampaign({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    createCampaign: Effect.fn("WorkspaceAdminApiClient.createCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        requestId: CliMutationRequestIdType,
        input: AdministrationCampaignCreateInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.createCampaign({
              payload: { requestId, campaign: input },
            })
          ),
          retryLedgerMutation(20),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    updateCampaign: Effect.fn("WorkspaceAdminApiClient.updateCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType,
        input: AdministrationCampaignUpdateInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.updateCampaign({
              params: { campaignId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    duplicateCampaign: Effect.fn("WorkspaceAdminApiClient.duplicateCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        requestId: CliMutationRequestIdType,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.duplicateCampaign({
              params: { campaignId },
              payload: { requestId },
            })
          ),
          retryLedgerMutation(20),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    deleteCampaign: Effect.fn("WorkspaceAdminApiClient.deleteCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.deleteCampaign({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    previewCampaignRecipients: Effect.fn(
      "WorkspaceAdminApiClient.previewCampaignRecipients"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.previewCampaignRecipients({
              params: { campaignId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    testSendCampaign: Effect.fn("WorkspaceAdminApiClient.testSendCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType,
        input: AdministrationCampaignTestSendInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.testSendCampaign({
              params: { campaignId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    sendCampaign: Effect.fn("WorkspaceAdminApiClient.sendCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType,
        input: AdministrationCampaignSendInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.sendCampaign({
              params: { campaignId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    retryCampaign: Effect.fn("WorkspaceAdminApiClient.retryCampaign")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType,
        input: AdministrationCampaignRetryInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.retryCampaign({
              params: { campaignId },
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getCampaignSendStatus: Effect.fn(
      "WorkspaceAdminApiClient.getCampaignSendStatus"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.campaigns.getCampaignSendStatus({
              params: { campaignId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomation: Effect.fn("WorkspaceAdminApiClient.getAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.getAutomation({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    updateAutomationFlow: Effect.fn(
      "WorkspaceAdminApiClient.updateAutomationFlow"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        { campaignId, ...payload }: AutomationFlowUpdateType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.updateAutomationFlow({
              params: { campaignId },
              payload,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    dryRunAutomation: Effect.fn("WorkspaceAdminApiClient.dryRunAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.dryRunAutomation({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomationDryRun: Effect.fn(
      "WorkspaceAdminApiClient.getAutomationDryRun"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        { previewId, ...query }: AutomationPreviewRefType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.getAutomationDryRun({
              params: { previewId },
              query,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    activateAutomation: Effect.fn("WorkspaceAdminApiClient.activateAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        { campaignId, ...payload }: AutomationActivateInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.activateAutomation({
              params: { campaignId },
              payload,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    pauseAutomation: Effect.fn("WorkspaceAdminApiClient.pauseAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.pauseAutomation({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    resumeAutomation: Effect.fn("WorkspaceAdminApiClient.resumeAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.resumeAutomation({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    archiveAutomation: Effect.fn("WorkspaceAdminApiClient.archiveAutomation")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.archiveAutomation({ params: { campaignId } })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    listAutomationVersions: Effect.fn(
      "WorkspaceAdminApiClient.listAutomationVersions"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        campaignId: AdministrationCampaignIdType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.listAutomationVersions({
              params: { campaignId },
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomationVersion: Effect.fn(
      "WorkspaceAdminApiClient.getAutomationVersion"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: AutomationVersionRefType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.getAutomationVersion({ params: input })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomationRunStats: Effect.fn(
      "WorkspaceAdminApiClient.getAutomationRunStats"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        { campaignId, ...query }: AutomationRunStatsInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.getAutomationRunStats({
              params: { campaignId },
              query,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    listAutomationRuns: Effect.fn("WorkspaceAdminApiClient.listAutomationRuns")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        { campaignId, ...query }: AutomationRunListInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.listAutomationRuns({
              params: { campaignId },
              query,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomationRun: Effect.fn("WorkspaceAdminApiClient.getAutomationRun")(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: AutomationRunRefType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.getAutomationRun({ params: input })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    previewCalendarExpression: Effect.fn(
      "WorkspaceAdminApiClient.previewCalendarExpression"
    )(
      (
        accessToken: Redacted.Redacted<CliAccessTokenType>,
        input: CalendarPreviewInputType
      ) =>
        makeClient(accessToken).pipe(
          Effect.flatMap((authorized) =>
            authorized.automations.previewCalendarExpression({
              payload: input,
            })
          ),
          Effect.mapError(sanitizeCampaignError)
        )
    ),
    getAutomationEngineHealth: Effect.fn(
      "WorkspaceAdminApiClient.getAutomationEngineHealth"
    )((accessToken: Redacted.Redacted<CliAccessTokenType>) =>
      makeClient(accessToken).pipe(
        Effect.flatMap((authorized) =>
          authorized.automations.getAutomationEngineHealth({})
        ),
        Effect.mapError(sanitizeCampaignError)
      )
    ),
  };
});

/**
 * Resends a mutation under the same request ID while its outcome is unknown
 * or another attempt is still applying it; the server's mutation ledger
 * replays a completed one instead of applying it again.
 */
const retryLedgerMutation =
  (times: number) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.retry({
        schedule: Schedule.spaced("250 millis"),
        times,
        while: (cause) =>
          cause instanceof CliMutationInProgress ||
          cause instanceof CliServiceUnavailable ||
          HttpClientError.isHttpClientError(cause),
      })
    );

export class CliApiRequestError extends Data.TaggedError("CliApiRequestError")<{
  readonly message: string;
}> {}

const sanitizedRequestError = () =>
  new CliApiRequestError({
    message: "The CLI API request could not be completed.",
  });

const sanitizeRequestError = (
  cause:
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => (cause instanceof CliServiceUnavailable ? cause : sanitizedRequestError());

const sanitizeStartError = (
  cause:
    | CliAuthenticationRateLimited
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliAuthenticationRateLimited ||
    cause instanceof CliServiceUnavailable
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeGrantError = (
  cause:
    | CliGrantRejected
    | CliServiceUnavailable
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliGrantRejected ||
    cause instanceof CliServiceUnavailable
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeSessionError = (
  cause:
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliServiceUnavailable ||
    cause instanceof CliSessionUnauthorized
  ) {
    return cause;
  }
  return sanitizedRequestError();
};

const sanitizeResourceError = (
  cause:
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliResourceNotFound ? cause : sanitizeSessionError(cause);

/**
 * Invoice reads require a minimum `dhw`. The server refuses an older one
 * with `CliServiceUnavailable`, which released binaries already decode; a
 * `CliInputInvalid` refusal keeps its message the same way.
 */
const sanitizeInvoiceListError = (
  cause:
    | CliInputInvalid
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliInputInvalid
    ? new CliApiRequestError({ message: cause.message })
    : sanitizeSessionError(cause);

const sanitizeInvoiceError = (
  cause:
    | CliInputInvalid
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliInputInvalid
    ? new CliApiRequestError({ message: cause.message })
    : sanitizeResourceError(cause);

const sanitizeMutationError = (
  cause:
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) => {
  if (
    cause instanceof CliMutationInProgress ||
    cause instanceof CliMutationRejected
  ) {
    return cause;
  }
  return sanitizeResourceError(cause);
};

const sanitizeRejectedError = (
  cause:
    | CliMutationRejected
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationRejected ? cause : sanitizeSessionError(cause);

const sanitizeRejectedResourceError = (
  cause:
    | CliMutationRejected
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationRejected ? cause : sanitizeResourceError(cause);

const sanitizeInvoiceCreationError = (
  cause:
    | CliMutationInProgress
    | CliMutationRejected
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationInProgress || cause instanceof CliMutationRejected
    ? cause
    : sanitizeSessionError(cause);

const sanitizeAccessCodeCreationError = (
  cause:
    | CliMutationInProgress
    | CliMutationRejected
    | CliMutationUncertain
    | CliStandaloneAccessCodeCleanupRequired
    | CliStandaloneAccessCodeReconciled
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliMutationInProgress ||
  cause instanceof CliMutationRejected ||
  cause instanceof CliMutationUncertain ||
  cause instanceof CliStandaloneAccessCodeCleanupRequired ||
  cause instanceof CliStandaloneAccessCodeReconciled
    ? cause
    : sanitizeSessionError(cause);

const sanitizeCampaignError = (
  cause:
    | CliInputInvalid
    | CliMutationInProgress
    | CliMutationRejected
    | CliResourceNotFound
    | CliServiceUnavailable
    | CliSessionUnauthorized
    | HttpClientError.HttpClientError
    | Schema.SchemaError
) =>
  cause instanceof CliInputInvalid ||
  cause instanceof CliMutationInProgress ||
  cause instanceof CliMutationRejected
    ? cause
    : sanitizeResourceError(cause);
