import type { ReactNode } from "react";
import {
  BoardgameEmailRow,
  MultilineEmailText,
  renderBoardgameEmailHtml,
} from "@/features/email/backend/email-rendering";
import { siteConstants } from "@/shared/utils/constants";

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
      <h2 style={headingStyle}>Nová zpráva z kontaktního formuláře</h2>

      <h3 style={subheadingStyle}>Kontaktní údaje:</h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label="Jméno:"
            value={name}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label="Email:"
            value={email}
            cellStyle={cellStyle}
          />
          {phone ? (
            <BoardgameEmailRow
              label="Telefon:"
              value={phone}
              cellStyle={cellStyle}
            />
          ) : null}
          <BoardgameEmailRow
            label="Datum a čas:"
            value={formattedDate}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>Zpráva:</h3>
      <div style={messageStyle}>
        <MultilineEmailText value={message} />
      </div>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        Tato zpráva byla automaticky vygenerována z kontaktního formuláře na
        webu DeskoHub.
      </p>
    </ContactEmailContainer>
  );

export const renderContactConfirmationEmailHtml = ({
  locale,
  message,
}: {
  readonly locale?: string;
  readonly message: string;
}) =>
  renderBoardgameEmailHtml(
    <ContactEmailContainer>
      <h2 style={headingStyle}>
        {locale === "cs-CZ" ? "Potvrzení přijetí zprávy" : "Message Received"}
      </h2>
      <p>
        {locale === "cs-CZ"
          ? "Děkujeme za vaši zprávu. Přijali jsme ji a brzy vás budeme kontaktovat."
          : "Thank you for your message. We have received it and will contact you soon."}
      </p>

      <h3 style={subheadingStyle}>
        {locale === "cs-CZ" ? "Shrnutí vaší zprávy:" : "Your Message Summary:"}
      </h3>
      <div style={messageStyle}>
        <MultilineEmailText value={message} />
      </div>

      <p style={{ marginTop: "20px" }}>
        {locale === "cs-CZ"
          ? `Pokud máte jakékoliv další dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.contactEmail}.`
          : `If you have any other questions, please don't hesitate to contact us at ${siteConstants.contact.contactEmail}.`}
      </p>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        DeskoHub
        <br />
        {locale === "cs-CZ"
          ? "Váš prostor pro práci a kreativitu"
          : "Your space for work and creativity"}
      </p>
    </ContactEmailContainer>
  );
