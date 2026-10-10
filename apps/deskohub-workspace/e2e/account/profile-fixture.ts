/**
 * The synthetic profile the account lane completes and later books with.
 * The phone is submitted as-is; the provider PATCH normalizes it to E.164.
 */
export const workspaceE2EAccountProfileFixture = {
  firstName: "E2E",
  lastName: "Lane",
  phone: "+420 555 000 111",
} as const;

/** The display name the linked account contact shows for the fixture. */
export const workspaceE2EAccountProfileName = `${workspaceE2EAccountProfileFixture.firstName} ${workspaceE2EAccountProfileFixture.lastName}`;
