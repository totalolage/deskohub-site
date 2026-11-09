/**
 * The navigation hooks tests replace: Bun can't load expo-router itself (its
 * build imports image assets), so a test of a navigating component mocks it.
 * Bun keeps one module namespace per specifier for the whole run, with the
 * export names of the first mock, so every test file mocks expo-router with
 * this stand-in: it sets the hooks it needs and the rest stay inert.
 */
const inertHooks = {
  useFocusEffect: (_effect: () => undefined | (() => void)) => undefined,
  useIsFocused: () => true,
  useNavigation: () => ({ getState: () => ({ routes: [] as unknown[] }) }),
  usePreventRemove: (
    _prevent: boolean,
    _blocked: (event: { repeat: () => void }) => void
  ) => undefined as undefined | (() => void),
  useRoute: () => ({ key: "" }),
  useRouter: () => ({ push: (_href: unknown) => undefined }),
};

type ExpoRouterHooks = Record<
  keyof typeof inertHooks,
  (...args: never[]) => unknown
>;

/** An expo-router module whose `hooks` replace the inert defaults. */
export const expoRouterStandIn = (hooks: Partial<ExpoRouterHooks> = {}) => ({
  ...inertHooks,
  ...hooks,
});
