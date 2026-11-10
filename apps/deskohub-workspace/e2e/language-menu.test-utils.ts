/** A link the fixture's language menu offers. */
export type LanguageMenuFixtureLink = {
  readonly href: string;
  readonly label: string;
};

/**
 * Markup for the header's language menu as the e2e flows meet it: a
 * `data-language-menu-trigger` button that, once hydrated, opens on
 * pointerdown and on Enter, Space, or ArrowDown, and a `data-locale-switcher`
 * menu that exists only while open. The menu's first item is the current
 * language's row, which is no link, followed by the links with React click
 * props; opening from the keyboard focuses that first item, as the hydrated
 * menu does, so a flow must move to the link it wants. `hydrated: false`
 * leaves the trigger as the server-rendered fallback: no React props and no
 * handlers, so it never opens. It stands in for the menu's contract only,
 * not for Radix's timing, toggling, or focus management.
 */
export const languageMenuMarkup = ({
  hydrated = true,
  links,
}: {
  readonly hydrated?: boolean;
  readonly links: readonly LanguageMenuFixtureLink[];
}) => `<button type="button" aria-label="Language" data-language-menu-trigger>Language</button>
${
  hydrated
    ? `<script>
  (() => {
    const links = ${JSON.stringify(links)};
    const trigger = document.querySelector("[data-language-menu-trigger]");
    const open = () => {
      if (document.querySelector("[data-locale-switcher]")) return;
      const menu = document.createElement("div");
      menu.setAttribute("data-locale-switcher", "");
      menu.setAttribute("role", "menu");
      const current = document.createElement("div");
      current.textContent = "Current language";
      current.tabIndex = -1;
      current.setAttribute("aria-current", "true");
      current.setAttribute("role", "menuitem");
      menu.append(current);
      for (const { href, label } of links) {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = label;
        link.setAttribute("role", "menuitem");
        link.__reactProps$test = { onClick() {} };
        menu.append(link);
      }
      document.body.append(menu);
      return menu;
    };
    const onPointerDown = (event) => {
      if (event.button === 0) open();
    };
    const onKeyDown = (event) => {
      if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      open()?.querySelector("[role=menuitem]")?.focus();
    };
    trigger.addEventListener("pointerdown", onPointerDown);
    trigger.addEventListener("keydown", onKeyDown);
    trigger.__reactProps$test = { onKeyDown, onPointerDown };
  })();
</script>`
    : ""
}`;
