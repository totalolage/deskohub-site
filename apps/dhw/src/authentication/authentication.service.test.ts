import { describe, expect, test } from "bun:test";
import {
  CliAccessToken,
  CliSessionUnauthorized,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { CliSessionCredential } from "../credentials/cli-session-credential.service";
import { AuthenticationService } from "./authentication.service";

describe("AuthenticationService", () => {
  test("removes a stored credential when the API reports revocation", async () => {
    const accessToken = Schema.decodeUnknownSync(CliAccessToken)(
      "a".repeat(43)
    );
    let removals = 0;
    const apiLayer = Layer.succeed(WorkspaceAdminApiClient, {
      getInfo: Effect.die("not used"),
      startAuthentication: () => Effect.die("not used"),
      getAuthenticationStatus: () => Effect.die("not used"),
      exchangeGrant: () => Effect.die("not used"),
      getCurrentSession: () =>
        Effect.fail(
          new CliSessionUnauthorized({
            message: "The CLI session has been revoked.",
          })
        ),
      getOverview: () => Effect.die("not used"),
      getReservationActivity: () => Effect.die("not used"),
      listReservations: () => Effect.die("not used"),
      getReservation: () => Effect.die("not used"),
      backfillReservationProductDetails: () => Effect.die("not used"),
      listAdministrators: () => Effect.die("not used"),
      grantAdministrator: () => Effect.die("not used"),
      revokeAdministrator: () => Effect.die("not used"),
      backfillLegacyAdministrator: () => Effect.die("not used"),
      cancelReservation: () => Effect.die("not used"),
      mutateReservationAccess: () => Effect.die("not used"),
      findReservation: () => Effect.die("not used"),
      listBookings: () => Effect.die("not used"),
      getBooking: () => Effect.die("not used"),
      listOrders: () => Effect.die("not used"),
      getOrder: () => Effect.die("not used"),
      listOperations: () => Effect.die("not used"),
      getOperation: () => Effect.die("not used"),
      listCustomers: () => Effect.die("not used"),
      searchCustomers: () => Effect.die("not used"),
      getCustomer: () => Effect.die("not used"),
      getCustomerReservationActivity: () => Effect.die("not used"),
      listCustomerReservations: () => Effect.die("not used"),
      getDiscountDashboard: () => Effect.die("not used"),
      listDiscountGroups: () => Effect.die("not used"),
      getDiscountCode: () => Effect.die("not used"),
      getVoucher: () => Effect.die("not used"),
      listInvoices: () => Effect.die("not used"),
      getInvoice: () => Effect.die("not used"),
      getInvoicePdf: () => Effect.die("not used"),
      getInvoiceCreationDefaults: () => Effect.die("not used"),
      previewInvoice: () => Effect.die("not used"),
      createInvoice: () => Effect.die("not used"),
      resendInvoice: () => Effect.die("not used"),
      createStandaloneAccessCode: () => Effect.die("not used"),
      listSessions: () => Effect.die("not used"),
      mutateDiscounts: () => Effect.die("not used"),
      renameSession: () => Effect.die("not used"),
      revokeSession: () => Effect.die("not used"),
      listCampaignAudiences: () => Effect.die("not used"),
      getCampaignAudience: () => Effect.die("not used"),
      createCampaignAudience: () => Effect.die("not used"),
      updateCampaignAudience: () => Effect.die("not used"),
      archiveCampaignAudience: () => Effect.die("not used"),
      unarchiveCampaignAudience: () => Effect.die("not used"),
      deleteCampaignAudience: () => Effect.die("not used"),
      listCampaignTemplates: () => Effect.die("not used"),
      getCampaignSettings: () => Effect.die("not used"),
      previewCampaignTemplate: () => Effect.die("not used"),
      listCampaigns: () => Effect.die("not used"),
      getCampaign: () => Effect.die("not used"),
      createCampaign: () => Effect.die("not used"),
      updateCampaign: () => Effect.die("not used"),
      duplicateCampaign: () => Effect.die("not used"),
      deleteCampaign: () => Effect.die("not used"),
      previewCampaignRecipients: () => Effect.die("not used"),
      testSendCampaign: () => Effect.die("not used"),
      sendCampaign: () => Effect.die("not used"),
      retryCampaign: () => Effect.die("not used"),
      getCampaignSendStatus: () => Effect.die("not used"),
      getAutomation: () => Effect.die("not used"),
      updateAutomationFlow: () => Effect.die("not used"),
      dryRunAutomation: () => Effect.die("not used"),
      getAutomationDryRun: () => Effect.die("not used"),
      activateAutomation: () => Effect.die("not used"),
      pauseAutomation: () => Effect.die("not used"),
      resumeAutomation: () => Effect.die("not used"),
      archiveAutomation: () => Effect.die("not used"),
      listAutomationVersions: () => Effect.die("not used"),
      getAutomationVersion: () => Effect.die("not used"),
      getAutomationRunStats: () => Effect.die("not used"),
      listAutomationRuns: () => Effect.die("not used"),
      getAutomationRun: () => Effect.die("not used"),
      previewCalendarExpression: () => Effect.die("not used"),
      getAutomationEngineHealth: () => Effect.die("not used"),
    } satisfies WorkspaceAdminApiClient["Service"]);
    const credentialLayer = Layer.succeed(CliSessionCredential, {
      get: Effect.succeed(Redacted.make(accessToken)),
      set: () => Effect.void,
      remove: Effect.sync(() => {
        removals += 1;
        return true;
      }),
    } satisfies CliSessionCredential["Service"]);

    const authenticationLayer = AuthenticationService.Default.pipe(
      Layer.provide(Layer.mergeAll(apiLayer, credentialLayer))
    );

    const current = await AuthenticationService.pipe(
      Effect.flatMap((authentication) => authentication.current),
      Effect.provide(authenticationLayer),
      Effect.runPromise
    );

    expect(Option.isNone(current)).toBe(true);
    expect(removals).toBe(1);
  });
});
