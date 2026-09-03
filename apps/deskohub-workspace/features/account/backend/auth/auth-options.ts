import type { BetterAuthOptions } from "better-auth";

export const authOptions = {
  user: {
    additionalFields: {
      deletionRequestedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
  },
} satisfies BetterAuthOptions;
