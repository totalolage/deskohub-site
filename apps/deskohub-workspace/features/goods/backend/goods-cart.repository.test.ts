import { describe, expect, test } from "bun:test";

describe("GoodsCartRepository", () => {
  test("reads revision and items under one shared cart lock", async () => {
    const source = await Bun.file(
      new URL("./goods-cart.repository.ts", import.meta.url)
    ).text();
    const get = source.slice(
      source.indexOf('"GoodsCartRepository.get"'),
      source.indexOf('"GoodsCartRepository.setItem"')
    );

    expect(get).toContain("db.transaction((tx)");
    expect(get).toContain('.for("share")');
    expect(get).toContain("loadLockedCart(tx, cart)");
    expect(get.indexOf('.for("share")')).toBeLessThan(
      get.indexOf("loadLockedCart(tx, cart)")
    );
  });

  test("serializes revision checks and changes in one transaction", async () => {
    const source = await Bun.file(
      new URL("./goods-cart.repository.ts", import.meta.url)
    ).text();
    const setItem = source.slice(
      source.indexOf('"GoodsCartRepository.setItem"'),
      source.indexOf('"GoodsCartRepository.removeItem"')
    );
    const removeItem = source.slice(
      source.indexOf('"GoodsCartRepository.removeItem"'),
      source.indexOf("return { get, removeItem, setItem }")
    );
    const lockCart = source.slice(
      source.indexOf('"GoodsCartRepository.lockCart"'),
      source.indexOf('"GoodsCartRepository.loadLockedCart"')
    );

    for (const mutation of [setItem, removeItem]) {
      expect(mutation).toContain("db.transaction((tx)");
      expect(mutation).toContain("requireRevision");
      expect(mutation).toContain("advanceAndLoadCart");
      expect(mutation.indexOf("requireRevision")).toBeLessThan(
        mutation.indexOf("advanceAndLoadCart")
      );
    }
    expect(setItem).toContain("lockCart(tx, customerId)");
    expect(lockCart).toContain('.for("update")');
    expect(removeItem).toContain('.for("update")');
  });
});
