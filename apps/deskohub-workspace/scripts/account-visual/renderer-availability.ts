export const unavailableActionDescription = "Unavailable in component renderer";

export const markUnavailableActions = () => {
  const unavailableActionSelectors = [
    "#account-profile-submit",
    "#account-sign-out",
    "#delete-account-confirm",
    "#delete-account-reauth-send",
  ] as const;
  const unavailableDescription = "Unavailable in component renderer";

  for (const selector of unavailableActionSelectors) {
    const controls = document.querySelectorAll<HTMLButtonElement>(selector);
    for (const control of controls) {
      if (!control.disabled) control.disabled = true;
      if (control.dataset.accountVisualActionUnavailable !== "true")
        control.dataset.accountVisualActionUnavailable = "true";
      if (control.dataset.accountVisualUnavailable !== "true")
        control.dataset.accountVisualUnavailable = "true";
      if (control.getAttribute("aria-disabled") !== "true")
        control.setAttribute("aria-disabled", "true");
      if (control.title !== unavailableDescription)
        control.title = unavailableDescription;
      if (!control.hasAttribute("aria-description"))
        control.setAttribute("aria-description", unavailableDescription);
    }
  }
};
