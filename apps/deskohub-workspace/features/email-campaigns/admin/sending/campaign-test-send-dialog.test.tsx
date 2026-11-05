import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { m as customerMessages, type Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignIdSchema } from "../../campaign-identifiers";
import { describeCampaignLocales } from "./campaign-locale-names";

mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM, which @testing-library/react and the operation capture load,
// must load after the happy-dom registration to handle input events.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { captureCampaignOperations } = await import(
  "../campaign-operation-actions.test-utils"
);
const { CampaignTestSendDialog } = await import("./campaign-test-send-dialog");

const locale = "en-US";
const campaignId = campaignIdSchema.make("synthetic-campaign");
const adminInbox = testEmailAddress("campaign-admin-inbox");
const guest = testEmailAddress("campaign-test-guest");
const colleague = testEmailAddress("campaign-test-colleague");
const operations = captureCampaignOperations();

const openDialog = async ({
  dialogLocale = locale,
  ...props
}: Partial<Parameters<typeof CampaignTestSendDialog>[0]> & {
  readonly dialogLocale?: Locale;
} = {}) => {
  const view = render(
    <RouteLocaleProvider locale={dialogLocale}>
      <CampaignTestSendDialog
        adminInbox={adminInbox}
        campaignId={campaignId}
        contentLocales={["cs-CZ", "en-US"]}
        unsavedChanges={false}
        {...props}
      />
    </RouteLocaleProvider>
  );
  await act(async () => {
    fireEvent.click(
      view.getByRole("button", {
        name: m.emailCampaignsTestSendSubmit({}, { locale: dialogLocale }),
      })
    );
  });
  return view;
};

type DialogView = Awaited<ReturnType<typeof openDialog>>;

const dialogOf = (view: DialogView) => within(view.getByRole("dialog"));

const recipientList = (view: DialogView) =>
  Array.from(
    dialogOf(view)
      .getByRole("list", {
        name: m.emailCampaignsTestSendRecipientsLabel({}, { locale }),
      })
      .querySelectorAll("li"),
    (item) => item.textContent
  );

const recipientField = (view: DialogView) =>
  dialogOf(view).getByLabelText<HTMLInputElement>(
    m.emailCampaignsTestSendAddRecipientLabel({}, { locale })
  );

const addRecipient = async (view: DialogView, email: string) => {
  fireEvent.input(recipientField(view), { target: { value: email } });
  await act(async () => {
    fireEvent.click(
      dialogOf(view).getByRole("button", {
        name: m.emailCampaignsTestSendAdd({}, { locale }),
      })
    );
  });
};

const sendButton = (view: DialogView) =>
  dialogOf(view).getByRole("button", {
    name: m.emailCampaignsTestSendSubmit({}, { locale }),
  });

const duplicateMessage = m.emailCampaignsTestSendRecipientDuplicate(
  {},
  { locale }
);

describe("CampaignTestSendDialog", () => {
  beforeEach(() => operations.install());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("labels the close button in Czech on a Czech route", async () => {
    const view = await openDialog({
      dialogLocale: "cs-CZ",
      contentLocales: ["cs-CZ"],
    });

    expect(
      view.getByRole("button", {
        name: customerMessages.closeDialogLabel({}, { locale: "cs-CZ" }),
      })
    ).toBeTruthy();
  });

  test("lists the admin inbox first and adds extra recipients in lowercase", async () => {
    const view = await openDialog();

    await addRecipient(view, guest.toUpperCase());

    expect(recipientList(view)).toEqual([
      expect.stringContaining(adminInbox),
      guest,
    ]);
    await waitFor(() => expect(recipientField(view).value).toBe(""));
  });

  test("refuses the admin inbox or an address already listed, in any case", async () => {
    const view = await openDialog();

    await addRecipient(view, adminInbox.toUpperCase());
    await waitFor(() =>
      expect(dialogOf(view).getByText(duplicateMessage)).toBeTruthy()
    );

    await addRecipient(view, guest);
    await addRecipient(view, guest.toUpperCase());
    await waitFor(() =>
      expect(dialogOf(view).getByText(duplicateMessage)).toBeTruthy()
    );
    expect(recipientList(view)).toHaveLength(2);
  });

  test("checks the address before adding it", async () => {
    const view = await openDialog();

    await addRecipient(view, "not-an-address");

    await waitFor(() =>
      expect(
        dialogOf(view).getByText(
          m.emailCampaignsTestSendRecipientInvalid({}, { locale })
        )
      ).toBeTruthy()
    );
    expect(recipientField(view).getAttribute("aria-invalid")).toBe("true");
    expect(recipientList(view)).toHaveLength(1);
  });

  test("removes an extra recipient", async () => {
    const view = await openDialog();
    await addRecipient(view, guest);
    await addRecipient(view, colleague);

    fireEvent.click(
      dialogOf(view).getByRole("button", {
        name: m.emailCampaignsTestSendRemoveRecipient(
          { email: guest },
          { locale }
        ),
      })
    );

    expect(recipientList(view)).toEqual([
      expect.stringContaining(adminInbox),
      colleague,
    ]);
  });

  test("without a campaign inbox, lists only the extra recipients", async () => {
    const view = await openDialog({ adminInbox: null });

    expect(recipientList(view)).toEqual([]);
    await addRecipient(view, adminInbox);

    expect(recipientList(view)).toEqual([adminInbox]);
  });

  test("sends to the extra recipients, then shows what was sent", async () => {
    const view = await openDialog();
    await addRecipient(view, guest);

    fireEvent.click(sendButton(view));

    expect(operations.requests("testSendCampaign")).toEqual([
      {
        operation: "testSendCampaign",
        input: { campaignId, recipients: [guest] },
      },
    ]);
    expect(
      dialogOf(view)
        .getByRole("button", {
          name: m.emailCampaignsTestSendSubmitting({}, { locale }),
        })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(recipientField(view).hasAttribute("disabled")).toBe(true);

    const codeExpiresAt = "2026-11-02T10:15:00.000Z";
    operations.respond("testSendCampaign", {
      _tag: "Success",
      output: {
        recipients: [adminInbox, guest],
        locales: ["cs-CZ", "en-US"],
        codeExpiresAt,
      },
    });

    const status = dialogOf(view).getByRole("status");
    expect(status.textContent).toContain(
      m.emailCampaignsTestSendSent(
        {
          count: 4,
          languages: describeCampaignLocales(["cs-CZ", "en-US"], locale),
        },
        { locale }
      )
    );
    expect(
      Array.from(status.querySelectorAll("li"), (item) => item.textContent)
    ).toEqual([adminInbox, guest]);
    expect(status.textContent).toContain(
      m.emailCampaignsTestSendCodeExpires(
        { expiresAt: formatAdministrationDateTime(codeExpiresAt, locale) },
        { locale }
      )
    );
    expect(
      view.queryByLabelText(
        m.emailCampaignsTestSendAddRecipientLabel({}, { locale })
      )
    ).toBeNull();
    expect(
      dialogOf(view).getByRole("button", {
        name: m.emailCampaignsTestSendDone({}, { locale }),
      })
    ).toBeTruthy();
    expect(
      dialogOf(view).queryByRole("button", {
        name: m.emailCampaignsTestSendSubmit({}, { locale }),
      })
    ).toBeNull();
  });

  test("reports a test send that failed and clears it on the next try", async () => {
    const view = await openDialog();

    fireEvent.click(sendButton(view));
    operations.respond("testSendCampaign", {
      _tag: "Failure",
      category: "OperationConflict",
      code: "a-code-without-copy",
      message: "English port message",
    });

    expect(dialogOf(view).getByRole("alert").textContent).toBe(
      m.emailCampaignsTestSendFailed({}, { locale })
    );

    fireEvent.click(sendButton(view));

    expect(dialogOf(view).getByRole("alert").textContent).toBe("");
  });

  test("starts over when reopened after a send", async () => {
    const view = await openDialog();
    fireEvent.click(sendButton(view));
    operations.respond("testSendCampaign", {
      _tag: "Success",
      output: {
        recipients: [adminInbox],
        locales: ["cs-CZ"],
        codeExpiresAt: "2026-11-02T10:15:00.000Z",
      },
    });

    await act(async () => {
      fireEvent.click(
        dialogOf(view).getByRole("button", {
          name: m.emailCampaignsTestSendDone({}, { locale }),
        })
      );
    });
    expect(view.queryByRole("dialog")).toBeNull();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.emailCampaignsTestSendSubmit({}, { locale }),
        })
      );
    });

    expect(recipientField(view).value).toBe("");
    expect(sendButton(view).hasAttribute("disabled")).toBe(false);
  });

  test("shows the content languages that will be sent", async () => {
    const view = await openDialog();

    expect(
      dialogOf(view).getByText(
        describeCampaignLocales(["cs-CZ", "en-US"], locale)
      )
    ).toBeTruthy();
    expect(
      dialogOf(view).queryByText(
        m.emailCampaignsTestSendContentMissing({}, { locale })
      )
    ).toBeNull();
  });

  test("blocks sending unsaved changes", async () => {
    const view = await openDialog({ unsavedChanges: true });

    expect(
      dialogOf(view).getByText(
        m.emailCampaignsTestSendUnsavedChanges({}, { locale })
      )
    ).toBeTruthy();
    expect(sendButton(view).hasAttribute("disabled")).toBe(true);
  });

  test("blocks sending a campaign without content", async () => {
    const view = await openDialog({ contentLocales: [] });

    expect(
      dialogOf(view).getByText(
        m.emailCampaignsTestSendContentMissing({}, { locale })
      )
    ).toBeTruthy();
    expect(
      dialogOf(view).queryByText(
        m.emailCampaignsTestSendUnsavedChanges({}, { locale })
      )
    ).toBeNull();
    expect(sendButton(view).hasAttribute("disabled")).toBe(true);
  });
});
