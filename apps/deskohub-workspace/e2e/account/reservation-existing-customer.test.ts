import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { testEmailAddress } from "@deskohub/test-email";
import { chromium, type Page } from "@playwright/test";
import type { ReservationCustomerMode } from "@/features/reservation/reservation-existing-customer";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import {
  isWorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  type WorkspaceE2EReservationExistingCustomerDiagnosticCode,
} from "../errors";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import {
  reservationExistingCustomerFailureMessage,
  reservationExistingCustomerOperation,
  verifyReservationExistingCustomer,
} from "./reservation-existing-customer";

const baseUrl = "https://reservation-customer.example.test";
const contact = {
  email: testEmailAddress("delivered+synthetic-run-main"),
  name: "E2E Lane",
} as const;
const privateFailureDetails = "private reservation customer fixture details";

type FailurePhase = "card-email" | "contact-review";

type FakeState = {
  mode: ReservationCustomerMode;
};

const settledSubmitKey =
  'locator:#reservation-submit[data-reservation-availability-loading="false"][data-reservation-price-loading="false"]';

const contactFieldByLabel = (label: string) =>
  ["Email", "Phone", "Name"].find((field) =>
    new RegExp(label).test(`${field} *`)
  );

const makeFakePage = (failurePhase?: FailurePhase) => {
  const state: FakeState = { mode: "account" };

  const fail = (): never => {
    throw new Error(privateFailureDetails);
  };

  const isVisible = (key: string): boolean => {
    if (key === "region:Booking as") return state.mode === "account";
    if (key === "button:Book for someone else") return state.mode === "account";
    if (key.startsWith("text:")) {
      if (
        failurePhase === "card-email" &&
        key === `text:${contact.email}` &&
        state.mode === "account"
      )
        return false;
      return (
        state.mode === "account" &&
        (key === `text:${contact.name}` || key === `text:${contact.email}`)
      );
    }
    if (key.startsWith("textbox:")) return state.mode === "contact";
    if (key === settledSubmitKey) return true;
    return false;
  };

  const countFor = (key: string): number => (isVisible(key) ? 1 : 0);

  const makeLocator = (key: string) => ({
    click: async () => {
      if (key === "button:Book for someone else") state.mode = "contact";
    },
    count: async () => countFor(key),
    elementHandle: async () => ({
      dispose: async () => {},
      key,
    }),
    first: () => makeLocator(key),
    getByText: (text: string, options: { readonly exact?: boolean }) => {
      expect(options.exact).toBe(true);
      return makeLocator(`text:${text}`);
    },
    waitFor: async (options: { readonly state?: string }) => {
      if (options.state === "hidden") {
        if (isVisible(key)) fail();
        return;
      }
      expect(options.state).toBe("visible");
      if (!isVisible(key)) fail();
    },
  });

  const page = Object.assign({} as Page, {
    getByRole: (
      role: string,
      options: { readonly exact?: boolean; readonly name: RegExp | string }
    ) => {
      if (role === "textbox") {
        expect(options.name).toBeInstanceOf(RegExp);
        const field = contactFieldByLabel((options.name as RegExp).source);
        if (field === undefined) throw new Error("unknown contact field");
        return makeLocator(`textbox:${field}`);
      }
      expect(options.exact).toBe(true);
      return makeLocator(`${role}:${String(options.name)}`);
    },
    evaluate: async () => {},
    goto: async () => {
      state.mode = "account";
      return null;
    },
    locator: (selector: string) => makeLocator(`locator:${selector}`),
    waitForFunction: async () => {
      return {
        dispose: async () => {},
        jsonValue: async () => "ready",
      } as never;
    },
  });

  const captureReview = async (mode: ReservationCustomerMode) => {
    if (failurePhase === "contact-review" && mode === "contact") fail();
  };

  return { captureReview, page };
};

const expectReservationCustomerFailure = (
  failure: unknown,
  diagnosticCode: WorkspaceE2EReservationExistingCustomerDiagnosticCode
) => {
  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError)) return;

  expect(isWorkspaceE2EDiagnosticCode(failure.diagnosticCode)).toBe(true);
  expect(failure).toMatchObject({
    diagnosticCode,
    message: reservationExistingCustomerFailureMessage,
    operation: reservationExistingCustomerOperation,
  });
  expect(failure.cause).toBeUndefined();
  expect(failure.causes).toBeUndefined();
  const serialized = JSON.stringify(failure);
  for (const privateValue of [
    privateFailureDetails,
    contact.email,
    contact.name,
  ]) {
    expect(failure.message).not.toContain(privateValue);
    expect(serialized).not.toContain(privateValue);
  }
  const annotation = formatWorkspaceE2EFailureAnnotation({
    caseId: "account-profile-completion",
    diagnosticCode: failure.diagnosticCode,
    failureKind: "error",
    outcome: "failed",
    stepId: "verifyPages",
  });
  expect(annotation).toContain(`diagnostic_code=${diagnosticCode}`);
  expect(annotation).not.toContain(privateFailureDetails);
  expect(annotation).not.toContain(contact.email);
};

const failurePhases = [
  {
    phase: "card-email",
    diagnosticCode: "account_reservation_existing_customer_card_failed",
  },
  {
    phase: "contact-review",
    diagnosticCode:
      "account_reservation_existing_customer_contact_review_failed",
  },
] as const satisfies ReadonlyArray<{
  readonly diagnosticCode: WorkspaceE2EReservationExistingCustomerDiagnosticCode;
  readonly phase: FailurePhase;
}>;

for (const { diagnosticCode, phase } of failurePhases) {
  test(`redacts a ${phase} failure with its closed diagnostic`, async () => {
    const fake = makeFakePage(phase);
    const failure = await verifyReservationExistingCustomer({
      baseUrl,
      captureReview: fake.captureReview,
      contact,
      page: fake.page,
      reviewScreenshots: true,
    }).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expectReservationCustomerFailure(failure, diagnosticCode);
  });
}

const chromiumAvailable = await playwrightChromiumAvailable();

/**
 * A static stand-in for the cowork customer section: the account card and
 * the contact inputs with the reservation form's required-label marker, and
 * buttons that only work once a React-like click prop is attached.
 */
const reservationCustomerDocument = `<!doctype html>
<html lang="en">
  <head>
    <title>Cowork reservation</title>
    <style>label.required::after { content: " *"; }</style>
  </head>
  <body>
    <main>
      <div style="height: 2000px"></div>
      <form id="reservation-form" novalidate></form>
      <span data-slot="skeleton" style="display: block; height: 8px"></span>
      <button
        data-reservation-availability-loading="true"
        data-reservation-price-loading="false"
        id="reservation-submit"
        type="button"
      >Continue</button>
    </main>
    <script>
      const contact = ${JSON.stringify(contact)};
      const form = document.getElementById("reservation-form");
      const attachClick = (button, onClick) => {
        setTimeout(() => {
          button["__reactProps$fixture"] = { onClick };
          button.addEventListener("click", onClick);
        }, 50);
      };
      const renderAccount = () => {
        form.innerHTML = \`
          <section aria-labelledby="reservation-existing-customer-heading">
            <h3 id="reservation-existing-customer-heading">Booking as</h3>
            <dl>
              <div><dt>Name</dt><dd></dd></div>
              <div><dt>Email</dt><dd></dd></div>
              <div><dt>Phone</dt><dd>+420555000111</dd></div>
            </dl>
          </section>
          <button type="button">Book for someone else</button>\`;
        const values = form.querySelectorAll("dd");
        values[0].textContent = contact.name;
        values[1].textContent = contact.email;
        attachClick(form.querySelector("button"), renderContact);
      };
      const field = (id, label, type) =>
        \`<div><label class="required" for="\${id}">\${label}</label>
          <input id="\${id}" type="\${type}" value="" required></div>\`;
      const renderContact = () => {
        form.innerHTML =
          field("contact-email", "Email", "email") +
          field("contact-phone", "Phone", "text") +
          field("contact-name", "Name", "text") +
          '<button type="button">Use my account details</button>';
        attachClick(form.querySelector("button"), renderAccount);
      };
      renderAccount();
      setTimeout(() => {
        document.querySelector('[data-slot="skeleton"]').remove();
        document
          .getElementById("reservation-submit")
          .setAttribute("data-reservation-availability-loading", "false");
      }, 100);
    </script>
  </body>
</html>`;

const startReservationCustomerServer = async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "text/html" });
    response.end(reservationCustomerDocument);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("reservation customer server did not receive a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    requests,
  };
};

test.skipIf(!chromiumAvailable)(
  "finds the card, buttons, and required-labelled inputs by role in a browser",
  async () => {
    const server = await startReservationCustomerServer();
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const reviewed: Array<{
          readonly cardVisible: boolean;
          readonly inputCount: number;
          readonly mode: ReservationCustomerMode;
          readonly pathname: string;
          readonly scrollY: number;
        }> = [];

        await verifyReservationExistingCustomer({
          baseUrl: server.baseUrl,
          captureReview: async (mode) => {
            reviewed.push({
              cardVisible: await page
                .getByRole("region", { exact: true, name: "Booking as" })
                .isVisible(),
              inputCount: await page.locator("input").count(),
              mode,
              pathname: new URL(page.url()).pathname,
              scrollY: await page.evaluate(() => window.scrollY),
            });
          },
          contact,
          page,
          reviewScreenshots: true,
        });

        expect(reviewed).toEqual([
          {
            cardVisible: true,
            inputCount: 0,
            mode: "account",
            pathname: "/en-US/reservation/cowork",
            scrollY: 0,
          },
          {
            cardVisible: false,
            inputCount: 3,
            mode: "contact",
            pathname: "/en-US/reservation/cowork",
            scrollY: 0,
          },
        ]);
        // One document load, no form submission.
        expect(server.requests).toEqual([
          "GET /en-US/reservation/cowork?step=contact",
        ]);
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  },
  30_000
);
