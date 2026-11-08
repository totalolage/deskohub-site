import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { AppLocaleProvider } from "../i18n/locale-context";
import { elementTree, type HostProps } from "../ui/testing/element-tree";
import { SampleDataBanner } from "./sample-data-banner";

function Screens() {
  return null;
}
const screens = <Screens />;

const styleOf = (element: ReactElement<HostProps>) =>
  Object.assign({}, ...[element.props.style].flat(Infinity));

const insets = { top: 24, right: 8, bottom: 16, left: 4 };

const bannerTree = (onNextKind: () => void = () => undefined) => {
  const tree = elementTree(
    SampleDataBanner,
    { kind: "linked", onNextKind, children: screens },
    (probe) => (
      <AppLocaleProvider locale="en-US">
        <SafeAreaInsetsContext.Provider value={insets}>
          {probe}
        </SafeAreaInsetsContext.Provider>
      </AppLocaleProvider>
    )
  );
  if (!isValidElement<HostProps>(tree)) throw new Error("no element");
  const [banner, content] = Children.toArray(tree.props.children).filter(
    (child): child is ReactElement<HostProps> => isValidElement(child)
  );
  if (banner === undefined || content === undefined)
    throw new Error("expected the banner and the screens");
  return { tree, banner, content };
};

describe("SampleDataBanner", () => {
  test("sits in the layout above the screens instead of over them", () => {
    const { tree, banner, content } = bannerTree();
    expect(tree.type).toBe("View");
    expect(styleOf(tree).flexDirection ?? "column").toBe("column");
    expect(banner.type).toBe("Pressable");
    expect(styleOf(banner).position).toBeUndefined();
    expect(content.type).toBe(SafeAreaInsetsContext.Provider);
    const [screensFrame] = Children.toArray(content.props.children).filter(
      (child): child is ReactElement<HostProps> => isValidElement(child)
    );
    expect(screensFrame?.type).toBe("View");
    expect(styleOf(screensFrame as ReactElement<HostProps>)).toMatchObject({
      flex: 1,
    });
    expect(styleOf(screensFrame as ReactElement<HostProps>).position).toBe(
      undefined
    );
    expect(
      Children.toArray(
        (screensFrame as ReactElement<HostProps>).props.children
      ).map((child) => isValidElement(child) && child.type)
    ).toEqual([Screens]);
  });

  test("clears the top inset itself, so the screens below get none", () => {
    const { banner, content } = bannerTree();
    expect(styleOf(banner)).toMatchObject({
      paddingTop: insets.top,
      minHeight: expect.any(Number),
    });
    expect(styleOf(banner).minHeight).toBeGreaterThan(insets.top);
    expect(content.props.value).toEqual({ ...insets, top: 0 });
  });

  test("switches to the next state when pressed", () => {
    let presses = 0;
    const { banner } = bannerTree(() => {
      presses += 1;
    });
    expect(banner.props.role).toBe("button");
    (banner.props.onPress as () => void)();
    expect(presses).toBe(1);
  });
});
