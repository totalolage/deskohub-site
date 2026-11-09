/** A link the fixture's language menu offers. */
export type LanguageMenuFixtureLink = {
  readonly href: string;
  readonly label: string;
};

/**
 * Markup for the header's language menu as the e2e flows meet it: a
 * `data-language-menu-trigger` button that, once hydrated, opens on
 * pointerdown and on Enter, Space, or ArrowDown, and a `data-locale-switcher`
 * menu that exists only while open and holds the links with React click
 * props. Opening from the keyboard focuses the first link, as the hydrated
 * menu does. `hydrated: false` leaves the trigger as the server-rendered
 * fallback: no React props and no handlers, so it never opens.
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
      open()?.querySelector("a")?.focus();
    };
    trigger.addEventListener("pointerdown", onPointerDown);
    trigger.addEventListener("keydown", onKeyDown);
    trigger.__reactProps$test = { onKeyDown, onPointerDown };
  })();
</script>`
    : ""
}`;
