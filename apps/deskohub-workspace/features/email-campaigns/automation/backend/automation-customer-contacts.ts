import "server-only";

import {
  type DotyposCustomerId,
  DotyposService,
  getCustomerDisplayName,
  readInIdFilterBatches,
} from "@deskohub/dotypos";
import { Effect, Option } from "effect";

/** A customer's name and email as Dotypos has them now. */
export interface AutomationCustomerContact {
  readonly name: string | null;
  readonly email: string | null;
}

/**
 * The current contacts of `customers`, read live from Dotypos one id batch
 * at a time and never stored. A customer Dotypos doesn't return is missing
 * from the map. Contacts are a convenience for the admin views, so when
 * Dotypos can't be read the result is none instead of a failure.
 */
export const readAutomationCustomerContacts = Effect.fn(
  "readAutomationCustomerContacts"
)(function* (customers: Iterable<DotyposCustomerId>) {
  const dotypos = yield* DotyposService;
  return yield* readInIdFilterBatches(customers, dotypos.getCustomersPage, {
    concurrency: 1,
  }).pipe(
    Effect.map((pages) =>
      Option.some(
        new Map(
          pages.flat().flatMap((profile) =>
            profile.id === undefined
              ? []
              : [
                  [
                    profile.id,
                    {
                      name: getCustomerDisplayName(profile) ?? null,
                      email: profile.email?.trim() || null,
                    } satisfies AutomationCustomerContact,
                  ] as const,
                ]
          )
        ) as ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
      )
    ),
    // Only the tag and status: Dotypos failures can carry customer values.
    Effect.catch((cause) =>
      Effect.logWarning("Customer contacts couldn't be read", {
        errorTag: cause._tag,
        statusCode: "statusCode" in cause ? cause.statusCode : undefined,
      }).pipe(
        Effect.as(
          Option.none<
            ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
          >()
        )
      )
    )
  );
});
