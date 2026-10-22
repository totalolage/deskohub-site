import {
  isWorkspaceE2EReferralCaseId,
  workspaceE2ECasePoolOrder,
} from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout", () => {
  registerWorkspaceE2ECases(workspaceE2ECasePoolOrder, {
    // Checkout needs a verified account: referral cases, the someone-else
    // referral payment, the signed-out verification, and the agent booking
    // bind their own run-scoped identities, the automation journey wraps its
    // booker in the admin flow and engine waits, and every other submitting
    // case signs in as its own seeded booker.
    bindCase: async (input) => {
      if (isWorkspaceE2EReferralCaseId(input.testCase.id)) {
        const { bindWorkspaceE2EReferralCase } = await import(
          "../referrals/cases"
        );
        return bindWorkspaceE2EReferralCase(input);
      }
      const {
        referralSomeoneElsePaymentCaseId,
        bindReferralSomeoneElsePaymentCase,
      } = await import("../cases/referral-someone-else-payment");
      if (input.testCase.id === referralSomeoneElsePaymentCaseId) {
        return bindReferralSomeoneElsePaymentCase(input);
      }
      const { signedOutVerificationCaseId, bindSignedOutVerificationCase } =
        await import("../cases/signed-out-verification");
      if (input.testCase.id === signedOutVerificationCaseId) {
        return bindSignedOutVerificationCase(input);
      }
      const { agentBookingCaseId, bindAgentBookingCase } = await import(
        "../cases/agent-booking"
      );
      if (input.testCase.id === agentBookingCaseId) {
        return bindAgentBookingCase(input);
      }
      const { automationReservationCaseId, bindAutomationReservationCase } =
        await import("../email-campaigns/automation-reservation-case");
      if (input.testCase.id === automationReservationCaseId) {
        return bindAutomationReservationCase(input);
      }
      const { bindWorkspaceE2ECheckoutBooker } = await import(
        "../checkout/booker"
      );
      return bindWorkspaceE2ECheckoutBooker(input);
    },
  });
});
