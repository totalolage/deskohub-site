/**
 * The request header in which the proxy hands an administration page the
 * path and query the browser asked for, so the page guard can send a
 * signed-out visitor to sign-in and back. The proxy overwrites any value the
 * client sent, and the guard still validates it as a same-origin path.
 */
export const administrationRequestPathHeader = "x-deskohub-administration-path";
