import { createCloudinaryCacheTags } from "@deskohub/cloudinary";

export const cloudinaryTags = createCloudinaryCacheTags({
  namespace: "workspace-cdn",
});

/** Shared snapshots behind advisory reservation availability. */
export const availabilityTags = {
  tables: "workspace-availability-tables",
  reservations: "workspace-availability-reservations",
  calendar: "workspace-availability-calendar",
} as const;

/** Shared snapshots of the reservation details customers see. */
export const reservationRecordTags = {
  records: "workspace-reservation-records",
} as const;
