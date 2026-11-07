import type { ReferralCode } from "@deskohub/workspace-customer-api";
import { Context, Effect, Layer, Ref } from "effect";
import { parseReferralCode } from "@/features/referrals/client";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";

/**
 * What a request changed about the referral code the client remembers, for
 * its response to tell the client: the client owns that storage, so the
 * server can't write it.
 */
type CustomerReferralUpdate = {
  /** Remember this accepted code and send it with later bookings. */
  readonly rememberReferralCode?: ReferralCode;
  /** The code the client sent is used up: stop sending it. */
  readonly rememberedReferralCodeUsed?: true;
};

type ClientRememberedReferral = ReturnType<
  typeof RememberedReferral.fromClient
>;

interface ICustomerReferralUpdates {
  /**
   * The request's `RememberedReferral`, which records what a cookie would
   * have changed instead of writing it. It needs what
   * `RememberedReferral.fromClient` needs; every operation that provides it
   * shares the request's record.
   */
  readonly remembered: Layer.Layer<
    RememberedReferral,
    Layer.Error<ClientRememberedReferral>,
    Layer.Services<ClientRememberedReferral> | ReferralReleaseGate
  >;
  /** What the request recorded so far; read it after the operation. */
  readonly recorded: Effect.Effect<CustomerReferralUpdate>;
}

/**
 * The referral code a client application sent with a request, through
 * `x-deskohub-referral-code`, and what the request changed about it. Reads
 * are `RememberedReferral.fromClient`'s. Accepting a code records it for the
 * client to remember, only while referrals are released, as the site's
 * cookie is only written then; forgetting a settled code records that the
 * client's code is used. Provide one per request.
 */
export class CustomerReferralUpdates extends Context.Service<
  CustomerReferralUpdates,
  ICustomerReferralUpdates
>()("@deskohub-workspace/customer-api/CustomerReferralUpdates") {
  static fromClient = (code: string | undefined) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const recorded = yield* Ref.make<CustomerReferralUpdate>({});
        const record = (update: CustomerReferralUpdate) =>
          Ref.update(recorded, (updates) => ({ ...updates, ...update }));

        const remembered = Layer.effect(
          RememberedReferral,
          Effect.gen(function* () {
            const client = yield* RememberedReferral;
            const release = yield* ReferralReleaseGate;

            return RememberedReferral.of({
              ...client,
              remember: Effect.fn("CustomerReferralUpdates.remember")(
                function* (accepted) {
                  if (!(yield* release.isOpen)) return;
                  const referralCode = parseReferralCode(accepted);
                  if (referralCode !== undefined) {
                    yield* record({ rememberReferralCode: referralCode });
                  }
                }
              ),
              forgetIfSettled: Effect.fn(
                "CustomerReferralUpdates.forgetIfSettled"
              )(function* (booker) {
                if (yield* client.isSettled(booker)) {
                  yield* record({ rememberedReferralCodeUsed: true });
                }
              }),
            });
          })
        ).pipe(Layer.provide(RememberedReferral.fromClient(code)));

        return { remembered, recorded: Ref.get(recorded) };
      })
    );
}
