import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type MouseEvent,
} from "react";
import { navigate } from "./next-navigation";

type NavigationEvent = {
  readonly preventDefault: () => void;
};

export type LinkProps = Omit<
  ComponentPropsWithoutRef<"a">,
  "href" | "onNavigate"
> & {
  readonly href: string | URL;
  readonly onNavigate?: (event: NavigationEvent) => void;
  readonly prefetch?: boolean;
  readonly replace?: boolean;
  readonly scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function RendererLink(
  { href, onClick, onNavigate, replace, ...props },
  ref
) {
  const hrefValue = String(href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target !== "" &&
        event.currentTarget.target !== "_self") ||
      event.currentTarget.hasAttribute("download")
    ) {
      return;
    }

    const destination = new URL(hrefValue, window.location.href);
    if (destination.origin !== window.location.origin) return;

    let prevented = false;
    onNavigate?.({
      preventDefault: () => {
        prevented = true;
        event.preventDefault();
      },
    });
    if (prevented || event.defaultPrevented) return;

    event.preventDefault();
    navigate(destination, replace === true);
  };

  return <a {...props} ref={ref} href={hrefValue} onClick={handleClick} />;
});

export default Link;
