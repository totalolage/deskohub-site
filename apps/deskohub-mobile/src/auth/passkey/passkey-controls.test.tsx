import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  act,
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { analytics } from "../../analytics/analytics";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { clientRoot } from "../../testing/client-root";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { find, type HostProps, hostTree } from "../../ui/testing/element-tree";
import { PasskeyCeremonies, type PasskeyCeremonyApi } from "./passkey-ceremony";
import { PasskeyNotSupported, PasskeyRejected } from "./passkey-failure";

/** The ceremonies the controls run; each test sets the ones it needs. */
let ceremonies: PasskeyCeremonyApi = {
  isSupported: Effect.succeed(true),
  signIn: Effect.void,
  addPasskey: () => Effect.succeed({ id: "synthetic-passkey", name: "Pixel" }),
};

mock.module("./passkey-runtime", () => ({
  passkeyRuntime: ManagedRuntime.make(
    Layer.succeed(PasskeyCeremonies, {
      isSupported: Effect.suspend(() => ceremonies.isSupported),
      signIn: Effect.suspend(() => ceremonies.signIn),
      addPasskey: (input) => Effect.suspend(() => ceremonies.addPasskey(input)),
    })
  ),
}));

const { AddPasskeyAction } = await import("./add-passkey-action");
const { PasskeySignInOption } = await import("./passkey-sign-in-option");

const { render } = clientRoot();

type LiveMessageProps = ComponentProps<typeof LiveMessage>;

/** The `LiveMessage` elements of a tree, in document order. */
const liveMessagesIn = (node: ReactNode): ReadonlyArray<LiveMessageProps> => {
  if (!isValidElement<HostProps>(node)) return [];
  const nested = Children.toArray(node.props.children).flatMap(liveMessagesIn);
  return node.type === LiveMessage
    ? [node.props as unknown as LiveMessageProps, ...nested]
    : nested;
};

/**
 * Runs `component` inside a probe and keeps the tree it returned, so a test
 * can press its button and read its live region. The host components only
 * stand in as names, so the probe draws nothing; it runs each
 * `LiveMessage` in place, so the region's announcement runs as on a device.
 */
const draw = async <Props,>(
  component: (props: Props) => ReactNode,
  props: Props
) => {
  let tree: ReactNode = null;
  let regions: ReadonlyArray<ReactNode> = [];
  const Probe = () => {
    tree = component(props);
    regions = liveMessagesIn(tree).map(LiveMessage);
    return null;
  };
  await render(
    <AppLocaleProvider locale="en-US">
      <Probe />
    </AppLocaleProvider>
  );
  return {
    press: () =>
      act(async () => {
        const onPress = find(tree, "Pressable")?.props.onPress;
        if (typeof onPress !== "function") throw new Error("No button.");
        onPress();
      }),
    /** The props of the loading indicator in the button, if it shows one. */
    indicator: () => find(tree, LoadingIndicator)?.props,
    /** The control's live region, as its only `LiveMessage` draws it. */
    region: () => {
      expect(regions).toHaveLength(1);
      return find(hostTree(regions[0]), "Text")?.props;
    },
  };
};

const platform = Platform as { OS: string };
const accessibility = AccessibilityInfo as {
  announceForAccessibilityWithOptions?: (
    message: string,
    options: { readonly queue?: boolean }
  ) => void;
};
const announced: Array<{ message: string; queue: boolean | undefined }> = [];
let os = platform.OS;

beforeEach(() => {
  os = platform.OS;
  announced.length = 0;
  accessibility.announceForAccessibilityWithOptions = (message, options) => {
    announced.push({ message, queue: options.queue });
  };
});
afterEach(async () => {
  await render(null);
  platform.OS = os;
  delete accessibility.announceForAccessibilityWithOptions;
});

const notSupported = () => Effect.fail(new PasskeyNotSupported());
const added = () => Effect.succeed({ id: "synthetic-passkey", name: "Pixel" });

describe("AddPasskeyAction", () => {
  test("starts before the ceremony and settles after its outcome", async () => {
    const steps: Array<string> = [];
    ceremonies = {
      ...ceremonies,
      addPasskey: () =>
        Effect.sync(() => steps.push("ceremony")).pipe(
          Effect.as({ id: "synthetic-passkey", name: "Pixel" })
        ),
    };
    const action = await draw(AddPasskeyAction, {
      onStart: () => steps.push("start"),
      onAdded: () => steps.push("added"),
      onSettled: () => steps.push("settled"),
      onReauthenticationRequired: () => steps.push("reauthenticate"),
    });

    await action.press();

    expect(steps).toEqual(["start", "ceremony", "added", "settled"]);
  });

  test("settles after asking for a recent sign-in", async () => {
    const steps: Array<string> = [];
    ceremonies = {
      ...ceremonies,
      addPasskey: () =>
        Effect.fail(
          new PasskeyRejected({ status: 403, code: "SESSION_NOT_FRESH" })
        ),
    };
    const action = await draw(AddPasskeyAction, {
      onStart: () => steps.push("start"),
      onSettled: () => steps.push("settled"),
      onReauthenticationRequired: () => steps.push("reauthenticate"),
    });

    await action.press();

    expect(steps).toEqual(["start", "reauthenticate", "settled"]);
  });

  test.each([
    ["success", added],
    ["failure", notSupported],
  ])("announces its %s politely on iOS", async (_case, addPasskey) => {
    platform.OS = "ios";
    ceremonies = { ...ceremonies, addPasskey };
    const action = await draw(AddPasskeyAction, {
      onReauthenticationRequired: () => undefined,
    });

    await action.press();

    const message = action.region()?.children;
    expect(typeof message === "string" && message.length > 0).toBe(true);
    expect(action.region()?.role).toBe("status");
    expect(announced).toEqual([{ message: String(message), queue: true }]);
  });

  test("leaves the announcement to the live region on Android", async () => {
    platform.OS = "android";
    ceremonies = { ...ceremonies, addPasskey: notSupported };
    const action = await draw(AddPasskeyAction, {
      onReauthenticationRequired: () => undefined,
    });

    await action.press();

    expect(action.region()?.accessibilityLiveRegion).toBe("polite");
    expect(announced).toEqual([]);
  });
});

describe("PasskeySignInOption", () => {
  test("records the sign-in as started with the passkey method before its ceremony runs", async () => {
    const steps: Array<string> = [];
    const capture = spyOn(analytics, "capture").mockImplementation((event) => {
      steps.push(`${event.name} ${JSON.stringify(event.properties)}`);
    });
    try {
      ceremonies = {
        ...ceremonies,
        signIn: Effect.sync(() => {
          steps.push("ceremony");
        }),
      };
      const option = await draw(PasskeySignInOption, {
        onSignedIn: () => steps.push("signed in"),
      });

      await option.press();

      expect(steps).toEqual([
        'sign-in started {"method":"passkey"}',
        "ceremony",
        "signed in",
      ]);
    } finally {
      capture.mockRestore();
    }
  });

  test("announces a failure assertively on iOS", async () => {
    platform.OS = "ios";
    ceremonies = { ...ceremonies, signIn: notSupported() };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });

    await option.press();

    const message = option.region()?.children;
    expect(typeof message === "string" && message.length > 0).toBe(true);
    expect(option.region()?.role).toBe("alert");
    expect(announced).toEqual([{ message: String(message), queue: false }]);
  });

  test("leaves the announcement to the live region on Android", async () => {
    platform.OS = "android";
    ceremonies = { ...ceremonies, signIn: notSupported() };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });

    await option.press();

    expect(option.region()?.accessibilityLiveRegion).toBe("assertive");
    expect(announced).toEqual([]);
  });
});

// The button's busy state and label say it is working, so its die is hidden.
describe("the pending passkey buttons", () => {
  const idle = ceremonies;
  afterEach(() => {
    ceremonies = idle;
  });

  test("adding a passkey shows an accent inline die while it runs", async () => {
    ceremonies = { ...ceremonies, addPasskey: () => Effect.never };
    const action = await draw(AddPasskeyAction, {
      onReauthenticationRequired: () => undefined,
    });
    expect(action.indicator()).toBeUndefined();

    await action.press();

    expect(action.indicator()).toEqual({
      size: "inline",
      tone: { color: theme.colors.accent },
    });
  });

  test("signing in with a passkey shows a navy inline die while it runs", async () => {
    ceremonies = { ...ceremonies, signIn: Effect.never };
    const option = await draw(PasskeySignInOption, {
      onSignedIn: () => undefined,
    });
    expect(option.indicator()).toBeUndefined();

    await option.press();

    expect(option.indicator()).toEqual({ size: "inline", tone: "navy" });
  });
});
