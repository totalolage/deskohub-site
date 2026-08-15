"use server";

import { Effect, Option, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { type Locale, m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { deleteCustomerIdentity } from "./backend/customer-account-deletion";
import { CustomerAccountLinkRepository } from "./backend/customer-account-link.repository";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import {
  deleteCustomerAccountStandardSchema,
  updateCustomerProfileStandardSchema,
} from "./contracts";
import { customerAccountIdSchema } from "./customer-account";

const actionError = (message: string) => new PublicSafeActionError({ message });

const requireActionUser = (locale: Locale) =>
  Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.flatMap((user) =>
      user
        ? Effect.succeed(user)
        : Effect.fail(actionError(m.accountSessionExpired({}, { locale })))
    ),
    Effect.mapError(() => actionError(m.accountSessionExpired({}, { locale })))
  );

const updateCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.update-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.gen(function* () {
      yield* requireActionUser(locale);
      const authentication = yield* CustomerAuthentication;
      yield* authentication
        .updateName(input.name)
        .pipe(
          Effect.mapError(() =>
            actionError(m.accountProfileError({}, { locale }))
          )
        );
      yield* Effect.sync(() => revalidatePath(`/${locale}/account`));
      return { status: "updated" as const };
    }).pipe(Effect.provide(CustomerAuthentication.Default))
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
      const user = yield* requireActionUser(locale);
      const accountId = Option.getOrUndefined(
        Schema.decodeUnknownOption(customerAccountIdSchema)(user.id)
      );
      if (!accountId) {
        return yield* Effect.fail(
          actionError(m.accountSessionExpired({}, { locale }))
        );
      }

      const links = yield* CustomerAccountLinkRepository;
      const authentication = yield* CustomerAuthentication;
      yield* deleteCustomerIdentity(
        accountId,
        links.unlink,
        authentication.deleteUser
      ).pipe(
        Effect.mapError(() => actionError(m.accountDeleteError({}, { locale })))
      );
      return { status: "deleted" as const };
    }).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.provide(CustomerAccountLinkRepository.Live)
    )
);

export const deleteCustomerAccount: typeof deleteCustomerAccountAction = async (
  ...args: Parameters<typeof deleteCustomerAccountAction>
) => {
  "use server";
  return await deleteCustomerAccountAction(...args);
};
