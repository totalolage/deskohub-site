import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CustomerAuthApi } from "../customer-api.service";
import { fakeCustomerApiLayer } from "./fake-customer-data";
import { FakeWorkspace } from "./fake-workspace";

const refusal = (
  workspace: FakeWorkspace,
  request: (auth: CustomerAuthApi["Service"]) => Effect.Effect<unknown, unknown>
) =>
  Effect.runPromise(
    Effect.flatMap(Effect.service(CustomerAuthApi), request).pipe(
      Effect.flip,
      Effect.provide(fakeCustomerApiLayer(workspace))
    )
  );

describe("the fake Workspace's Better Auth passkey endpoints", () => {
  test("refuse renaming an unknown passkey as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.updatePasskey({ payload: { id: "unknown", name: "Name" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "PASSKEY_NOT_FOUND",
    });
  });

  test("refuse deleting an unknown passkey as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const passkeys = workspace.data.passkeys;

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.deletePasskey({ payload: { id: "unknown" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "PASSKEY_NOT_FOUND",
    });
    expect(workspace.data.passkeys).toEqual(passkeys);
  });
});

describe("the fake Workspace's Better Auth consent endpoint", () => {
  test("refuses disconnecting an unknown assistant as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const assistants = workspace.data.assistants;

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.deleteConsent({ payload: { id: "unknown" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "not_found",
    });
    expect(workspace.data.assistants).toEqual(assistants);
  });
});
