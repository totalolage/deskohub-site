import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

type ActionResult = {
  readonly data?: {
    readonly status: "uploaded" | "removed" | "rejected" | "retryable";
    readonly avatar?: { readonly url: string; readonly version?: number };
  };
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

const routerRefresh = mock(() => undefined);

let uploadResult: () => Promise<ActionResult> = () =>
  Promise.resolve({ data: { status: "uploaded" } });
const removeCustomerAvatar = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "removed" } })
);

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/features/account/avatar-actions", () => ({
  uploadCustomerAvatar: () => uploadResult(),
  removeCustomerAvatar,
}));

let AvatarControlForTest: typeof import("./avatar-control")["AvatarControl"];
const { m } = await import("@/features/i18n");

const renderControl = () =>
  render(
    <AvatarControlForTest
      avatar={{
        url: "https://res.cloudinary.test/upload/v1/avatars/live",
        version: 1,
      }}
      firstName="Ada"
      lastName="Lovelace"
      locale="en-US"
    />
  );

const chooseFile = (view: ReturnType<typeof renderControl>, file: File) => {
  const input = view.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
};

describe("AvatarControl failure feedback", () => {
  beforeAll(async () => {
    ({ AvatarControl: AvatarControlForTest } = await import(
      "./avatar-control"
    ));
  });

  afterEach(() => {
    cleanup();
    uploadResult = () => Promise.resolve({ data: { status: "uploaded" } });
    removeCustomerAvatar.mockClear();
    routerRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("shows a localized validation error for a zero-byte file and keeps the previous image", async () => {
    uploadResult = () =>
      Promise.resolve({
        data: undefined,
        validationErrors: { formErrors: ["Choose an image to upload."] },
      } satisfies ActionResult);

    const view = renderControl();
    expect(
      view.getByAltText(m.accountProfileAvatarAlt({}, { locale: "en-US" }))
    ).toBeDefined();

    await act(async () => {
      chooseFile(view, new File([], "empty.png", { type: "image/png" }));
    });

    await waitFor(() =>
      expect(
        view.getByText(
          m.accountProfileAvatarErrorFileMissing({}, { locale: "en-US" })
        )
      ).toBeDefined()
    );
    // The previous image is untouched.
    expect(
      view.getByAltText(m.accountProfileAvatarAlt({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test("shows a localized generic error when the action transport rejects and keeps the previous image", async () => {
    uploadResult = () => Promise.reject(new Error("network down"));

    const view = renderControl();

    await act(async () => {
      chooseFile(
        view,
        new File(["png-bytes"], "photo.png", { type: "image/png" })
      );
    });

    await waitFor(() =>
      expect(
        view.getByText(
          m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
        )
      ).toBeDefined()
    );
    expect(
      view.getByAltText(m.accountProfileAvatarAlt({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test("clears a stale error when a new upload attempt starts", async () => {
    uploadResult = () => Promise.reject(new Error("network down"));

    const view = renderControl();
    await act(async () => {
      chooseFile(
        view,
        new File(["png-bytes"], "photo.png", { type: "image/png" })
      );
    });
    await waitFor(() =>
      expect(
        view.getByText(
          m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
        )
      ).toBeDefined()
    );

    uploadResult = () =>
      new Promise(() => {
        // Pending for the rest of the test: the mutation has started.
      });
    await act(async () => {
      chooseFile(
        view,
        new File(["png-bytes"], "photo-2.png", { type: "image/png" })
      );
    });

    expect(
      view.queryByText(
        m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
      )
    ).toBeNull();
    expect(
      view.getByText(m.accountProfileAvatarUploading({}, { locale: "en-US" }))
    ).toBeDefined();
  });
});
