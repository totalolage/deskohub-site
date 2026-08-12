"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { auth } from "@/features/account/auth.server";
import { CustomerAccountService } from "@/features/account/backend/customer-account.service";
import {
  deleteCustomerAccountStandardSchema,
  updateCustomerProfileStandardSchema,
} from "@/features/account/contracts";
import { getCustomerAccountId } from "@/features/account/session.server";
import { type Locale, m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const requireActionSession = (locale: Locale) =>
  Effect.tryPromise({
    try: () => auth.getSession(),
    catch: () =>
      new PublicSafeActionError({
        message: m.accountSessionExpired({}, { locale }),
      }),
  }).pipe(
    Effect.flatMap((result) => {
      const accountId = getCustomerAccountId(result.data?.user.id);
      return result.error || !result.data?.user || !accountId
        ? Effect.fail(
            new PublicSafeActionError({
              message: m.accountSessionExpired({}, { locale }),
            })
          )
        : Effect.succeed({ accountId, session: result.data });
    })
  );

const updateCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.update-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.gen(function* () {
      yield* requireActionSession(locale);
      const result = yield* Effect.tryPromise({
        try: () => auth.updateUser({ name: input.name }),
        catch: () =>
          new PublicSafeActionError({
            message: m.accountProfileError({}, { locale }),
          }),
      });
      if (result.error) {
        return yield* new PublicSafeActionError({
          message: m.accountProfileError({}, { locale }),
        });
      }

      yield* Effect.sync(() => revalidatePath(`/${locale}/account`));
      return { status: "updated" as const };
    })
);

export const updateCustomerProfile: typeof updateCustomerProfileAction = async (
  ...args: Parameters<typeof updateCustomerProfileAction>
) => {
  "use server";
  return await updateCustomerProfileAction(...args);
};

const deleteCustomerAccountAction = defineWorkspaceAction(
  {
    operation: "account.delete",
    schema: deleteCustomerAccountStandardSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    Effect.gen(function* () {
      const { accountId } = yield* requireActionSession(locale);
      const accounts = yield* CustomerAccountService;
      yield* accounts.unlink(accountId).pipe(
        Effect.mapError(
          () =>
            new PublicSafeActionError({
              message: m.accountDeleteError({}, { locale }),
            })
        )
      );

      const result = yield* Effect.tryPromise({
        try: () => auth.deleteUser(),
        catch: () =>
          new PublicSafeActionError({
            message: m.accountDeleteError({}, { locale }),
          }),
      });
      if (result.error) {
        return yield* new PublicSafeActionError({
          message: m.accountDeleteError({}, { locale }),
        });
      }

      return { status: "deleted" as const };
    }).pipe(Effect.provide(CustomerAccountService.LiveWithDependencies))
);

export const deleteCustomerAccount: typeof deleteCustomerAccountAction = async (
  ...args: Parameters<typeof deleteCustomerAccountAction>
) => {
  "use server";
  return await deleteCustomerAccountAction(...args);
};
