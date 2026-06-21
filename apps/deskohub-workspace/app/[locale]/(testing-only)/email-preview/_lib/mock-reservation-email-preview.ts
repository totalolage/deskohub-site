import type { Customer } from "@deskohub/dotypos/generated";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";

const mockDate = new Date("2026-06-12T09:00:00.000+02:00");
const mockEndDate = new Date("2026-06-13T09:00:00.000+02:00");

export const workspaceReservationEmailPreviewTableName = "12";

export const workspaceReservationEmailPreviewCustomer: Customer = {
  _cloudId: "preview-cloud-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Analytical Engines Ltd.",
  email: "customer@example.com",
  phone: "+420 123 456 789",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

export const createWorkspaceReservationEmailPreviewReservation = (
  locale: string
): WorkspaceReservationDetails => ({
  id: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  dotyposCustomerId: "987654321",
  dotyposReservationId: "123456789",
  customerAccessCode: "4829",
  productTier: "profi",
  productCoffee: true,
  productMonitorOption: "2x27-qhd",
  locale,
  customer: workspaceReservationEmailPreviewCustomer,
  reservedFrom: mockDate,
  reservedUntil: mockEndDate,
  tableName: workspaceReservationEmailPreviewTableName,
  tableMap: {
    assignedTableId: "desk-12",
    roomName: "Main room",
    tables: [
      {
        _cloudId: "preview-cloud-id",
        id: "desk-12",
        name: "12",
        locationName: "Main room",
        positionX: "40",
        positionY: "80",
        type: "SQUARE",
      },
      {
        _cloudId: "preview-cloud-id",
        id: "desk-11",
        name: "11",
        locationName: "Main room",
        positionX: "130",
        positionY: "80",
        type: "SQUARE",
      },
    ],
  },
});
