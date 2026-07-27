"use server";

import { Effect, Match } from "effect";
import { redirect } from "next/navigation";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import type {
  DiscountCodeId,
  StoredDiscountId,
} from "../persistence-contracts";
import { requireDiscountAdminAuthorization } from "./basic-auth.server";
import {
  type DiscountAdminMutation,
  discountAdminMutationStandardSchema,
} from "./contracts";
import { DiscountAdministrationLive } from "./discount-administration.runtime";
import { DiscountAdministration } from "./discount-administration.service";

const executeDiscountAdminMutation = Effect.fn(
  "DiscountAdministration.executeMutation"
)(function* (input: DiscountAdminMutation) {
  const administration = yield* DiscountAdministration;

  yield* Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      "create-discount": ({ discount }) =>
        administration.createDiscount(discount),
      "update-discount": ({ discount }) =>
        administration.updateDiscount(discount),
      "delete-discount": ({ id }) => administration.deleteDiscount({ id }),
      "create-code": ({ code }) => administration.createCode(code),
      "update-code": ({ code }) => administration.updateCode(code),
      "delete-code": ({ id }) => administration.deleteCode({ id }),
    })
  );

  return {
    notice: Match.value(input.kind).pipe(
      Match.when("create-discount", () => "Discount created."),
      Match.when("update-discount", () => "Discount updated."),
      Match.when("delete-discount", () => "Discount deleted."),
      Match.when("create-code", () => "Discount code created."),
      Match.when("update-code", () => "Discount code updated."),
      Match.when("delete-code", () => "Discount code deleted."),
      Match.exhaustive
    ),
  };
});

const discountAdminMutationAction = defineWorkspaceAction(
  {
    operation: "discount-administration.mutate",
    schema: discountAdminMutationStandardSchema,
  },
  (input) =>
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(executeDiscountAdminMutation(input)),
      Effect.provide(DiscountAdministrationLive),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message:
              "The change could not be saved. Check the values and any existing references, then try again.",
            cause,
          })
      )
    )
);

export const mutateDiscountAdmin: typeof discountAdminMutationAction = async (
  ...args: Parameters<typeof discountAdminMutationAction>
) => {
  "use server";
  return await discountAdminMutationAction(...args);
};

export async function createDiscountAdminForm(formData: FormData) {
  const result = await mutateDiscountAdmin({
    kind: "create-discount",
    discount: readDiscountForm(formData),
  });
  redirectWithResult(result, "/admin/discounts");
}

export async function updateDiscountAdminForm(
  id: StoredDiscountId,
  formData: FormData
) {
  const result = await mutateDiscountAdmin({
    kind: "update-discount",
    discount: {
      id,
      ...readDiscountForm(formData),
    },
  });
  redirectWithResult(result, "/admin/discounts");
}

export async function deleteDiscountAdminForm(
  id: StoredDiscountId,
  _formData: FormData
) {
  const result = await mutateDiscountAdmin({
    kind: "delete-discount",
    id,
  });
  redirectWithResult(result, "/admin/discounts");
}

export async function createDiscountCodeAdminForm(formData: FormData) {
  const result = await mutateDiscountAdmin({
    kind: "create-code",
    code: readDiscountCodeForm(formData),
  });
  redirectWithResult(result, "/admin/codes");
}

export async function updateDiscountCodeAdminForm(
  id: DiscountCodeId,
  formData: FormData
) {
  const result = await mutateDiscountAdmin({
    kind: "update-code",
    code: {
      id,
      ...readDiscountCodeForm(formData),
    },
  });
  redirectWithResult(result, "/admin/codes");
}

export async function deleteDiscountCodeAdminForm(
  id: DiscountCodeId,
  _formData: FormData
) {
  const result = await mutateDiscountAdmin({
    kind: "delete-code",
    id,
  });
  redirectWithResult(result, "/admin/codes");
}

const readDiscountForm = (formData: FormData) => {
  const kind = readString(formData, "adjustmentKind");

  return {
    labels: {
      "cs-CZ": readString(formData, "labelCs"),
      "en-US": readString(formData, "labelEn"),
    },
    adjustment:
      kind === "fixed"
        ? ({
            kind: "fixed",
            amount: {
              value: Number(readString(formData, "fixedAmountValue")),
              exponent: Number(readString(formData, "fixedAmountExponent")),
              currency: readString(
                formData,
                "fixedAmountCurrency"
              ).toUpperCase(),
            },
          } as const)
        : ({
            kind: "percentage",
            basisPoints: Number(readString(formData, "percentageBasisPoints")),
          } as const),
    products: formData
      .getAll("products")
      .flatMap((value) =>
        typeof value === "string" ? (productIdentities[value] ?? []) : []
      ) as [WorkspaceProductIdentity, ...WorkspaceProductIdentity[]],
  };
};

const readDiscountCodeForm = (formData: FormData) => ({
  discountId: readString(formData, "discountId") as StoredDiscountId,
  code: readString(formData, "code").trim().toUpperCase(),
  enabled: formData.get("enabled") === "on",
  validFrom: readOptionalString(formData, "validFrom"),
  validUntil: readOptionalString(formData, "validUntil"),
  maxUses: readOptionalNumber(formData, "maxUses"),
});

const readString = (formData: FormData, field: string) => {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
};

const readOptionalString = (formData: FormData, field: string) => {
  const value = readString(formData, field).trim();
  return value.length > 0 ? value : null;
};

const readOptionalNumber = (formData: FormData, field: string) => {
  const value = readOptionalString(formData, field);
  return value === null ? null : Number(value);
};

const redirectWithResult = (
  result: Awaited<ReturnType<typeof mutateDiscountAdmin>>,
  pathname: "/admin/codes" | "/admin/discounts"
): never => {
  const notice =
    result.data?.notice ??
    result.serverError ??
    "The change could not be saved. Check the form and try again.";
  const params = new URLSearchParams({
    notice,
    status: result.data ? "success" : "error",
  });
  redirect(`${pathname}?${params}`);
};

const productIdentities: Readonly<
  Record<string, readonly WorkspaceProductIdentity[]>
> = {
  "cowork:basic": [{ kind: "cowork", tier: "basic" }],
  "cowork:plus": [{ kind: "cowork", tier: "plus" }],
  "cowork:profi": [{ kind: "cowork", tier: "profi" }],
  "meeting-room:60": [{ kind: "meeting-room", durationMinutes: 60 }],
  "meeting-room:240": [{ kind: "meeting-room", durationMinutes: 240 }],
  "meeting-room:1440": [{ kind: "meeting-room", durationMinutes: 1440 }],
};
