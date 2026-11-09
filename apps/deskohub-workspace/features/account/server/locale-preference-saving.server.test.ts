import { beforeEach, expect, mock, test } from "bun:test";

const isCustomerSignedIn = mock();
const updateLocalePreference = mock();

mock.module("@/features/account/actions", () => ({
  updateLocalePreference,
}));
mock.module("@/features/account/server/customer-session.server", () => ({
  isCustomerSignedIn,
}));

beforeEach(() => {
  isCustomerSignedIn.mockReset();
});

test("a signed-in customer's switch saves through the locale preference action", async () => {
  const { createLocalePreferenceSaving } = await import(
    "./locale-preference-saving.server"
  );
  isCustomerSignedIn.mockResolvedValue(true);

  const preference = createLocalePreferenceSaving();

  expect(await preference.signedIn).toBe(true);
  expect(preference.save).toBe(updateLocalePreference);
});

test("treats a failed session check as a guest switch", async () => {
  const { createLocalePreferenceSaving } = await import(
    "./locale-preference-saving.server"
  );
  isCustomerSignedIn.mockRejectedValue(new Error("synthetic failure"));

  expect(await createLocalePreferenceSaving().signedIn).toBe(false);
});
