import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { GoodsCatalogService } from "@/features/goods/backend";
import { makeGoodsCatalogRoute } from "./route";

const account = {
  accountId: Schema.decodeUnknownSync(customerAccountIdSchema)("account-id"),
  dotyposCustomerId: Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
    "customer-id"
  ),
};

describe("goods catalog route", () => {
  test("authenticates through the public resolver and projects the requested locale", async () => {
    const locales: string[] = [];
    const GET = makeGoodsCatalogRoute(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsCatalogService, {
          getCatalog: (locale) => {
            locales.push(locale);
            return Effect.succeed({ categories: [] });
          },
        })
      )
    );

    const response = await GET(
      new Request("https://workspace.test/api/v1/goods/catalog?locale=cs-CZ")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ categories: [] });
    expect(locales).toEqual(["cs-CZ"]);
  });
});
