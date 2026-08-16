"use server";

import { Effect, Option, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { deleteCustomerIdentity } from "./backend/customer-account-deletion";
import { CustomerAccountLinkRepository } from "./backend/customer-account-link.repository";
import { CustomerAuthentication } from "./backend/customer-authentication.service";
import {
  deleteCustomerAccountStandardSchema,
  updateCustomerProfileStandardSchema,
} from "./contracts";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "./customer-account";

const actionError = (message: string, cause: CustomerAccountAccessError) =>
  new PublicSafeActionError({ message, cause });

const requireActionUser = () =>
  Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.flatMap((user) =>
      user
        ? Effect.succeed(user)
        : Effect.fail(
            new CustomerAccountAccessError({ reason: "unauthenticated" })
          )
    )
  );

const requireActionAccountId = () =>
  requireActionUser().pipe(
    Effect.flatMap((user) => {
      const accountId = Option.getOrUndefined(
        Schema.decodeUnknownOption(customerAccountIdSchema)(user.id)
      );
      return accountId
        ? Effect.succeed(accountId)
        : Effect.fail(
            new CustomerAccountAccessError({ reason: "unauthenticated" })
          );
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
      yield* requireActionUser();
      const authentication = yield* CustomerAuthentication;
      yield* authentication.updateName(input.name);
      yield* Effect.sync(() => revalidatePath(`/${locale}/account`));
      return { status: "updated" as const };
    }).pipe(
      Effect.mapError((cause) =>
        actionError(
          cause.reason === "unauthenticated"
            ? m.accountSessionExpired({}, { locale })
            : m.accountProfileError({}, { locale }),
          cause
        )
      ),
      Effect.provide(CustomerAuthentication.Default)
    )
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
      const accountId = yield* requireActionAccountId();

      const links = yield* CustomerAccountLinkRepository;
      const authentication = yield* CustomerAuthentication;
      yield* deleteCustomerIdentity(
        accountId,
        links.withAccountLock,
        requireActionAccountId(),
        links.unlink,
        authentication.deleteUser
      );
      return { status: "deleted" as const };
    }).pipe(
      Effect.mapError((cause) =>
        actionError(
          cause.reason === "unauthenticated"
            ? m.accountSessionExpired({}, { locale })
            : m.accountDeleteError({}, { locale }),
          cause
        )
      ),
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
