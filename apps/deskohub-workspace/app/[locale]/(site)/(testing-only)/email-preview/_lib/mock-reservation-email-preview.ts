import {
  DotyposCloudIdSchema,
  type DotyposCustomer,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  type DotyposTable,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { getCustomerReservationPlacement } from "@/features/reservation/backend/customer-reservation-placement";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import "@/shared/polyfills/temporal";
import { testEmailAddress } from "@deskohub/test-email";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  type StoredWorkspaceReservationDetails,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";

const mockDate = Temporal.Instant.from("2026-06-12T09:00:00.000+02:00");
const mockEndDate = Temporal.Instant.from("2026-06-13T09:00:00.000+02:00");

const workspaceReservationEmailPreviewTableName = "12";

const previewReservationDetails: StoredWorkspaceReservationDetails = {
  kind: "cowork",
  entryTier: "profi",
  coffee: true,
  monitorOption: "2x27-qhd",
};

const previewOpenSpaceReservationDetails: StoredWorkspaceReservationDetails = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: false,
};

const makePreviewTable = (input: {
  readonly id: string;
  readonly name: string;
  readonly positionX: string;
  readonly tags: readonly string[];
}): DotyposTable => ({
  _cloudId: DotyposCloudIdSchema.make("preview-cloud-id"),
  id: DotyposTableIdSchema.make(input.id),
  name: input.name,
  locationName: "Main room",
  positionX: input.positionX,
  positionY: "80",
  type: "SQUARE",
  enabled: true,
  display: true,
  seats: "1",
  tags: [...input.tags],
});

const workspaceReservationEmailPreviewCustomer: DotyposCustomer = {
  id: DotyposCustomerIdSchema.make("987654321"),
  _cloudId: DotyposCloudIdSchema.make("preview-cloud-id"),
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Analytical Engines Ltd.",
  email: testEmailAddress("customer"),
  phone: "+420 123 456 789",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

export const createWorkspaceReservationEmailPreviewReservation = (
  locale: string
): WorkspaceReservationDetails => ({
  id: workspaceReservationIdSchema.make("workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("987654321"),
  authorAccountId: customerAccountIdSchema.make("email-preview-author"),
  dotyposReservationId: DotyposReservationIdSchema.make("123456789"),
  reservationDetails: previewReservationDetails,
  locale,
  customer: workspaceReservationEmailPreviewCustomer,
  providerStatus: "CONFIRMED",
  reservedFrom: mockDate,
  reservedUntil: mockEndDate,
  seats: 1,
  placement: getCustomerReservationPlacement({
    reservationDetails: previewReservationDetails,
    dotyposReservation: { _tableId: DotyposTableIdSchema.make("desk-12") },
    tables: [
      makePreviewTable({
        id: "desk-12",
        name: workspaceReservationEmailPreviewTableName,
        positionX: "40",
        tags: ["tier:profi"],
      }),
      makePreviewTable({
        id: "desk-11",
        name: "11",
        positionX: "130",
        tags: ["tier:profi"],
      }),
    ],
    seatingMap: true,
  }),
});

export const createWorkspaceOpenSpaceReservationEmailPreviewReservation = (
  locale: string
): WorkspaceReservationDetails => ({
  ...createWorkspaceReservationEmailPreviewReservation(locale),
  reservationDetails: previewOpenSpaceReservationDetails,
  placement: getCustomerReservationPlacement({
    reservationDetails: previewOpenSpaceReservationDetails,
    dotyposReservation: { _tableId: DotyposTableIdSchema.make("open-12") },
    tables: ["9", "10", "11", "12", "15", "16", "wallee", "gromice"].map(
      (name, index) =>
        makePreviewTable({
          id: `open-${name}`,
          name,
          positionX: String(40 + index * 90),
          tags: ["cowork:open-space"],
        })
    ),
    seatingMap: false,
  }),
});
