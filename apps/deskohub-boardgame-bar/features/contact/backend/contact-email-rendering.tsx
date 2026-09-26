import type { ReactNode } from "react";
import {
  BoardgameEmailRow,
  MultilineEmailText,
  renderBoardgameEmailHtml,
} from "@/features/email/backend/email-rendering";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { siteConstants } from "@/shared/utils/constants";

// Business email copy is Czech regardless of the customer locale.
const businessEmailLocale: Locale = "cs-CZ";

const containerStyle = {
  fontFamily: "Arial, sans-serif",
  maxWidth: "600px",
  margin: "0 auto",
} as const;

const headingStyle = { color: "#333" } as const;
const subheadingStyle = { color: "#666" } as const;
const tableStyle = { width: "100%", borderCollapse: "collapse" } as const;
const cellStyle = { padding: "8px", borderBottom: "1px solid #eee" } as const;
const messageStyle = {
  backgroundColor: "#f5f5f5",
  padding: "15px",
  borderRadius: "4px",
  whiteSpace: "pre-wrap",
} as const;
const hrStyle = {
  margin: "30px 0",
  border: "none",
  borderTop: "1px solid #eee",
} as const;
const footerStyle = { color: "#999", fontSize: "12px" } as const;

const ContactEmailContainer = ({
  children,
}: {
  readonly children: ReactNode;
}) => <div style={containerStyle}>{children}</div>;

export const renderBusinessContactEmailHtml = ({
  name,
  email,
  phone,
  formattedDate,
  message,
}: {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly formattedDate: string;
  readonly message: string;
}) =>
  renderBoardgameEmailHtml(
    <ContactEmailContainer>
      <h2 style={headingStyle}>
        {m["contact.email.businessHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h2>

      <h3 style={subheadingStyle}>
        {m["contact.email.contactDetailsHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label={m["contact.email.nameLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={name}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={m["contact.email.emailLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={email}
            cellStyle={cellStyle}
          />
          {phone ? (
            <BoardgameEmailRow
              label={m["contact.email.phoneLabel"](undefined, {
                locale: businessEmailLocale,
              })}
              value={phone}
              cellStyle={cellStyle}
            />
          ) : null}
          <BoardgameEmailRow
            label={m["contact.email.dateTimeLabel"](undefined, {
              locale: businessEmailLocale,
            })}
            value={formattedDate}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>
        {m["contact.email.messageHeading"](undefined, {
          locale: businessEmailLocale,
        })}
      </h3>
      <div style={messageStyle}>
        <MultilineEmailText value={message} />
      </div>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        {m["contact.email.footer"](undefined, { locale: businessEmailLocale })}
      </p>
    </ContactEmailContainer>
  );

export const renderContactConfirmationEmailHtml = ({
  locale,
  message,
}: {
  readonly locale: Locale;
  readonly message: string;
}) => {
  const contactLine = m["contact.email.confirmationContactLine"](
    { contactEmail: siteConstants.contact.contactEmail },
    { locale: locale }
  );
  return renderBoardgameEmailHtml(
    <ContactEmailContainer>
      <h2 style={headingStyle}>
        {m["contact.email.confirmationHeading"](undefined, {
          locale: locale,
        })}
      </h2>
      <p>
        {m["contact.email.confirmationThankYou"](undefined, {
          locale: locale,
        })}
      </p>

      <h3 style={subheadingStyle}>
        {m["contact.email.confirmationSummaryHeading"](undefined, {
          locale: locale,
        })}
      </h3>
      <div style={messageStyle}>
        <MultilineEmailText value={message} />
      </div>

      <p style={{ marginTop: "20px" }}>{contactLine}</p>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        DeskoHub
        <br />
        {m["contact.email.footerTagline"](undefined, {
          locale: locale,
        })}
      </p>
    </ContactEmailContainer>
  );
};
