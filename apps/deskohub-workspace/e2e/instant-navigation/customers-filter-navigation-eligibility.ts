// The delayed-response soft-navigation lifecycle can only be proven against a
// locally controlled server and a disposable database. Remote preview runs keep
// the existing instant-navigation coverage, and runs without an explicitly
// configured disposable Postgres test database must never connect to or
// migrate a runtime database. The disposable test URL configures the runtime,
// never the reverse.
export interface CustomersFilterNavigationEligibility {
  readonly skip: boolean;
  readonly reason: string;
}

export const customersFilterNavigationEligibility =
  (): CustomersFilterNavigationEligibility => {
    if (process.env.WORKSPACE_E2E_BASE_URL !== undefined) {
      return {
        skip: true,
        reason:
          "requires a local server; remote preview runs keep the existing instant-navigation coverage",
      };
    }
    if (process.env.WORKSPACE_TEST_DATABASE_URL === undefined) {
      return {
        skip: true,
        reason:
          "requires an explicitly configured disposable WORKSPACE_TEST_DATABASE_URL; the runtime DATABASE_URL is never used",
      };
    }
    return { skip: false, reason: "" };
  };
