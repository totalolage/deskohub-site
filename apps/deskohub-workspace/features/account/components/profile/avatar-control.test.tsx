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
let removeResult: () => Promise<ActionResult> = () =>
  Promise.resolve({ data: { status: "removed" } });
const removeCustomerAvatar = mock((): Promise<ActionResult> => removeResult());

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/features/account/avatar-actions", () => ({
  uploadCustomerAvatar: () => uploadResult(),
  removeCustomerAvatar,
}));

let AvatarControlForTest: typeof import("./avatar-control")["AvatarControl"];
const { m } = await import("@/features/i18n");

const renderControl = (locale: "en-US" | "cs-CZ" = "en-US") =>
  render(
    <AvatarControlForTest
      avatar={{
        url: "https://res.cloudinary.test/upload/v1/avatars/live",
        version: 1,
      }}
      firstName="Ada"
      lastName="Lovelace"
      locale={locale}
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
    removeResult = () => Promise.resolve({ data: { status: "removed" } });
    removeCustomerAvatar.mockClear();
    routerRefresh.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
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

  test("a later successful remove is not masked by a previous failed upload", async () => {
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

    removeResult = () => Promise.resolve({ data: { status: "removed" } });
    await act(async () => {
      fireEvent.click(
        view.getByText(m.accountProfileAvatarRemove({}, { locale: "en-US" }))
      );
    });

    await waitFor(() =>
      expect(
        view.getByText(m.accountProfileAvatarRemoved({}, { locale: "en-US" }))
      ).toBeDefined()
    );
    // The stale upload failure is gone and the image was removed.
    expect(
      view.queryByText(
        m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
      )
    ).toBeNull();
    expect(
      view.queryByAltText(m.accountProfileAvatarAlt({}, { locale: "en-US" }))
    ).toBeNull();
    expect(routerRefresh).toHaveBeenCalled();
  });

  test("a later successful upload is not masked by a previous failed remove", async () => {
    removeResult = () => Promise.reject(new Error("network down"));

    const view = renderControl();
    await act(async () => {
      fireEvent.click(
        view.getByText(m.accountProfileAvatarRemove({}, { locale: "en-US" }))
      );
    });
    await waitFor(() =>
      expect(
        view.getByText(
          m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
        )
      ).toBeDefined()
    );
    // The failed remove keeps the previous image in place.
    expect(
      view.getByAltText(m.accountProfileAvatarAlt({}, { locale: "en-US" }))
    ).toBeDefined();

    uploadResult = () =>
      Promise.resolve({
        data: {
          status: "uploaded",
          avatar: {
            url: "https://res.cloudinary.test/upload/v2/avatars/next",
            version: 2,
          },
        },
      });
    await act(async () => {
      chooseFile(
        view,
        new File(["png-bytes"], "photo-2.png", { type: "image/png" })
      );
    });

    await waitFor(() =>
      expect(
        view.getByText(m.accountProfileAvatarUpdated({}, { locale: "en-US" }))
      ).toBeDefined()
    );
    // The stale remove failure is gone and the new image is shown.
    expect(
      view.queryByText(
        m.accountProfileAvatarErrorGeneric({}, { locale: "en-US" })
      )
    ).toBeNull();
    const image = view.getByAltText(
      m.accountProfileAvatarAlt({}, { locale: "en-US" })
    ) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(
      "https://res.cloudinary.test/upload/v2/avatars/next"
    );
  });

  test("bounds the avatar column width and lets the remove label wrap (issue #411 tablet overflow)", () => {
    const view = renderControl("cs-CZ");
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bw-48\b/);

    const removeButton = view.getByRole("button", {
      name: m.accountProfileAvatarRemove({}, { locale: "cs-CZ" }),
    });
    const removeClass = removeButton.className;
    expect(removeClass).toMatch(/\bwhitespace-normal\b/);
    expect(removeClass).toMatch(/\bh-auto\b/);
    expect(removeClass).toMatch(/\bmin-h-8\b/);
  });

  test("exposes the Czech upload, pending, success, and remove controls accessibly", async () => {
    let settleUpload: ((result: ActionResult) => void) | undefined;
    uploadResult = () =>
      new Promise((resolve) => {
        settleUpload = resolve;
      });

    const view = renderControl("cs-CZ");
    const changeButton = view.getByRole("button", {
      name: m.accountProfileAvatarChange({}, { locale: "cs-CZ" }),
    });
    const fileInput = view.container.querySelector('input[type="file"]')!;

    expect(changeButton.getAttribute("type")).toBe("button");
    expect(fileInput.getAttribute("accept")).toBe(".jpg,.jpeg,.png,.webp");
    expect(view.getByRole("status").textContent).toBe("");

    await act(async () => {
      chooseFile(
        view,
        new File(["image-bytes"], "photo.png", { type: "image/png" })
      );
    });

    expect(view.getByRole("status").textContent).toBe(
      m.accountProfileAvatarUploading({}, { locale: "cs-CZ" })
    );
    expect(settleUpload).toBeDefined();

    await act(async () => {
      settleUpload!({
        data: {
          status: "uploaded",
          avatar: {
            url: "https://res.cloudinary.test/upload/v2/avatars/next",
            version: 2,
          },
        },
      });
    });

    expect(view.getByRole("status").textContent).toBe(
      m.accountProfileAvatarUpdated({}, { locale: "cs-CZ" })
    );
    const removeButton = view.getByRole("button", {
      name: m.accountProfileAvatarRemove({}, { locale: "cs-CZ" }),
    });
    let settleRemove: ((result: ActionResult) => void) | undefined;
    removeResult = () =>
      new Promise((resolve) => {
        settleRemove = resolve;
      });
    await act(async () => {
      fireEvent.click(removeButton);
    });
    expect(view.getByRole("status").textContent).toBe(
      m.accountProfileAvatarRemoving({}, { locale: "cs-CZ" })
    );
    expect(settleRemove).toBeDefined();
    await act(async () => {
      settleRemove!({ data: { status: "removed" } });
    });
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toBe(
        m.accountProfileAvatarRemoved({}, { locale: "cs-CZ" })
      )
    );

    uploadResult = () =>
      Promise.reject(new Error("provider details stay private"));
    await act(async () => {
      chooseFile(
        view,
        new File(["image-bytes"], "retry.png", { type: "image/png" })
      );
    });
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toBe(
        m.accountProfileAvatarErrorGeneric({}, { locale: "cs-CZ" })
      )
    );
  });
});
