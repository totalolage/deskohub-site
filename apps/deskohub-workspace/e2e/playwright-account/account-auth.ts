import { expect, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { customerAccountLinks } from "@/db/schema";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2EPromise, tryWorkspaceE2ESync } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runRetrySafeDatabaseOperation } from "../integrations/database-operation";
import type { NeonAuthMagicLinkCapture } from "../integrations/neon-auth";
import { pollUntil } from "../polling";
import { assert } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";

export type BrowserAuthSession = {
  readonly user: {
    readonly email: string;
    readonly emailVerified: boolean;
    readonly id: string;
    readonly name: string;
  };
};

export const browserStep = <A>(operation: string, run: () => Promise<A>) =>
  tryWorkspaceE2EPromise(operation, run);

export const requestMagicLink = ({
  callbackPath,
  capture,
  config,
  email,
  page,
  validateInvalidEmail,
}: {
  readonly callbackPath: string;
  readonly capture: NeonAuthMagicLinkCapture;
  readonly config: WorkspaceE2EConfig;
  readonly email: string;
  readonly page: Page;
  readonly validateInvalidEmail: boolean;
}) =>
  Effect.gen(function* () {
    yield* browserStep("open magic-link sign in", async () => {
      await page.goto(
        `/en-US/auth/sign-in?redirectTo=${encodeURIComponent(callbackPath)}`
      );
      const emailField = page.getByLabel("Email");
      if (validateInvalidEmail) {
        await emailField.fill("invalid");
        await page
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        await expect(page.getByText("Email is invalid")).toBeVisible();
      }
      await emailField.fill(email);
      await page
        .getByRole("button", { name: "Email me a sign-in link" })
        .click();
      await expect(
        page.getByText("Check your inbox for your sign-in link.")
      ).toBeVisible();
    });
    const verificationUrl = yield* capture.nextVerificationUrl(
      config,
      callbackPath
    );
    yield* browserStep("follow captured magic link", async () => {
      await page.goto(verificationUrl);
      await expect(page).toHaveURL((url) => url.pathname === callbackPath);
    });
  });

const readSession = (page: Page) =>
  browserStep("read authoritative Neon Auth session", () =>
    page.evaluate(async () => {
      const response = await fetch(
        "/api/auth/get-session?disableCookieCache=true",
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!response.ok) throw new Error("authoritative session request failed");
      return (await response.json()) as unknown;
    })
  );

export const requireSession = (page: Page, email: string) =>
  Effect.flatMap(readSession(page), (value) =>
    tryWorkspaceE2ESync("validate authoritative Neon Auth session", () => {
      assert(value && typeof value === "object", "auth session is missing");
      const user = (value as { readonly user?: unknown }).user;
      assert(user && typeof user === "object", "auth session user is missing");
      const candidate = user as Record<string, unknown>;
      assert(typeof candidate.id === "string", "auth user ID is invalid");
      assert(candidate.email === email, "auth user email does not match");
      assert(candidate.emailVerified === true, "auth user email is unverified");
      assert(typeof candidate.name === "string", "auth user name is invalid");
      return {
        user: {
          email: candidate.email,
          emailVerified: candidate.emailVerified,
          id: candidate.id,
          name: candidate.name,
        },
      } as BrowserAuthSession;
    })
  );

export const assertNoSession = (page: Page) =>
  Effect.flatMap(readSession(page), (session) =>
    tryWorkspaceE2ESync("assert absent Neon Auth session", () => {
      assert(session === null, "customer session is still active");
    })
  );

export const waitForCustomerAccountLink = (
  accountId: string,
  customerId: string | undefined,
  shouldExist: boolean
) =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const decodedAccountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
      accountId
    );
    yield* pollUntil(
      runRetrySafeDatabaseOperation(
        "read customer account link",
        db
          .select({ customerId: customerAccountLinks.dotyposCustomerId })
          .from(customerAccountLinks)
          .where(eq(customerAccountLinks.customerAccountId, decodedAccountId))
          .limit(1)
      ).pipe(
        Effect.map(([row]) => {
          if (!shouldExist) return row ? undefined : true;
          return row?.customerId === customerId ? true : undefined;
        })
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: shouldExist
          ? "customer account link"
          : "deleted customer account link",
        timeoutMs: 60_000,
      }
    );
  });

export const deleteCustomerAccountLinks = (accountIds: ReadonlySet<string>) =>
  Effect.gen(function* () {
    if (accountIds.size === 0) return;
    const { db } = yield* E2EDatabase;
    const decodedAccountIds = [...accountIds].map((accountId) =>
      Schema.decodeUnknownSync(customerAccountIdSchema)(accountId)
    );
    yield* runRetrySafeDatabaseOperation(
      "delete synthetic customer account links",
      db
        .delete(customerAccountLinks)
        .where(
          inArray(customerAccountLinks.customerAccountId, decodedAccountIds)
        )
    );
  });
