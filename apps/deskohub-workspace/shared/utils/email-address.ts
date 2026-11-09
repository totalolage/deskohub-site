/**
 * Shortens an email address for on-screen confirmation, keeping the first
 * character of the local part and the whole domain: `jana@example.cz`
 * becomes `j•••@example.cz`.
 */
export const maskEmailAddress = (email: string): string => {
  const separatorIndex = email.lastIndexOf("@");
  if (separatorIndex <= 0) return email;
  return `${email.slice(0, 1)}•••${email.slice(separatorIndex)}`;
};
