import { workspaceE2EAccountJournalDirectory } from "../account/journal";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";

export const instantNavigationActivityCustomerJournalOwner = {
  journalDirectory: workspaceE2EAccountJournalDirectory("instant-navigation"),
  ownerId: "instant-navigation-activity-customer",
  recipientLabels: ["nav-activity-customer"],
} as const satisfies WorkspaceE2EAccountJournalOwner;
