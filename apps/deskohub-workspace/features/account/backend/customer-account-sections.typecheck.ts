import type { Effect } from "effect";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "../customer-account";
import type {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "./customer-account-sections";
import type { CustomerAuthentication as OtherService } from "./customer-authentication.service";

declare const sections: CustomerAccountSections["Service"];
declare const accountId: CustomerAccountId;
declare const heldStep: Effect.Effect<void, never, HeldCustomerAccount>;
declare const heldStepWithService: Effect.Effect<
  void,
  never,
  HeldCustomerAccount | OtherService
>;

const typecheck = false as boolean;

if (typecheck) {
  const held: Effect.Effect<void, CustomerAccountAccessError, never> =
    sections.withActiveAccount(accountId, heldStep);
  const nested: Effect.Effect<void, CustomerAccountAccessError, never> =
    sections.withActiveAccount(
      accountId,
      sections.withActiveAccount(accountId, heldStep, { recheck: "active" })
    );
  const keepsOtherRequirements: Effect.Effect<
    void,
    CustomerAccountAccessError,
    OtherService
  > = sections.withActiveAccount(accountId, heldStepWithService, {
    recheck: "present",
  });

  // @ts-expect-error A held-only step cannot run outside a section.
  // @effect-diagnostics-next-line missingEffectContext:off
  const outside: Effect.Effect<void, never, never> = heldStep;

  // @ts-expect-error The section removes only HeldCustomerAccount from the requirements.
  // @effect-diagnostics-next-line missingEffectContext:off
  const lost: Effect.Effect<void, CustomerAccountAccessError, never> =
    sections.withActiveAccount(accountId, heldStepWithService);

  // @ts-expect-error The optional section may run anonymously, so it never provides the held account.
  // @effect-diagnostics-next-line missingEffectContext:off
  const optional: Effect.Effect<void, CustomerAccountAccessError, never> =
    sections.withOptionalAccount(() => heldStep);

  const closedRecheck = sections.withActiveAccount(accountId, heldStep, {
    // @ts-expect-error The recheck options are closed.
    recheck: "marker",
  });

  void [
    held,
    nested,
    keepsOtherRequirements,
    outside,
    lost,
    optional,
    closedRecheck,
  ];
}
