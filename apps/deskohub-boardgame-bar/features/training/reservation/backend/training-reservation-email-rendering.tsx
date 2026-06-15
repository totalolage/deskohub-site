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
const hrStyle = {
  margin: "30px 0",
  border: "none",
  borderTop: "1px solid #eee",
} as const;
const footerStyle = { color: "#999", fontSize: "12px" } as const;

const durationLabel = (duration: number, locale?: string) => {
  if (locale === "cs-CZ") {
    return duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin";
  }

  return duration === 1 ? "hour" : "hours";
};

const TrainingEmailContainer = ({
  children,
}: {
  readonly children: ReactNode;
}) => <div style={containerStyle}>{children}</div>;

export const renderBusinessTrainingReservationEmailHtml = ({
  fullName,
  company,
  role,
  email,
  phone,
  formattedDate,
  formattedTime,
  duration,
  specialRequirements,
}: {
  readonly fullName: string;
  readonly company: string;
  readonly role: string;
  readonly email: string;
  readonly phone: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly duration: number;
  readonly specialRequirements?: string;
}) =>
  renderBoardgameEmailHtml(
    <TrainingEmailContainer>
      <h2 style={headingStyle}>Nová rezervace školící místnosti</h2>

      <h3 style={subheadingStyle}>Kontaktní údaje:</h3>
      <table style={tableStyle}>
        <tbody>
          {fullName ? (
            <BoardgameEmailRow
              label="Jméno:"
              value={fullName}
              cellStyle={cellStyle}
            />
          ) : null}
          {company ? (
            <BoardgameEmailRow
              label="Společnost:"
              value={company}
              cellStyle={cellStyle}
            />
          ) : null}
          {role ? (
            <BoardgameEmailRow
              label="Pozice:"
              value={role}
              cellStyle={cellStyle}
            />
          ) : null}
          <BoardgameEmailRow
            label="Email:"
            value={email}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label="Telefon:"
            value={phone}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>
        Detaily rezervace:
      </h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label="Datum:"
            value={formattedDate}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label="Čas:"
            value={formattedTime}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label="Doba trvání:"
            value={`${duration} ${durationLabel(duration, "cs-CZ")}`}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      {specialRequirements ? (
        <>
          <h3 style={{ ...subheadingStyle, marginTop: "20px" }}>
            Speciální požadavky:
          </h3>
          <p
            style={{
              backgroundColor: "#f5f5f5",
              padding: "12px",
              borderRadius: "4px",
              whiteSpace: "pre-wrap",
            }}
          >
            <MultilineEmailText value={specialRequirements} />
          </p>
        </>
      ) : null}

      <div
        style={{
          backgroundColor: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "4px",
          padding: "15px",
          marginTop: "20px",
        }}
      >
        <h3 style={{ color: "#856404", marginTop: 0 }}>⚠️ Požadovaná akce:</h3>
        <p style={{ color: "#856404", margin: 0 }}>
          <strong>Zavolejte zákazníkovi pro potvrzení rezervace!</strong>
          <br />
          Telefon: <strong>{phone}</strong>
        </p>
      </div>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        Tato zpráva byla automaticky vygenerována z formuláře na webu DeskoHub.
      </p>
    </TrainingEmailContainer>
  );

export const renderTrainingReservationConfirmationEmailHtml = ({
  locale,
  formattedDate,
  formattedTime,
  duration,
}: {
  readonly locale?: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly duration: number;
}) =>
  renderBoardgameEmailHtml(
    <TrainingEmailContainer>
      <h2 style={headingStyle}>
        {locale === "cs-CZ"
          ? "Potvrzení přijetí rezervace"
          : "Reservation Received"}
      </h2>
      <p>
        {locale === "cs-CZ"
          ? "Děkujeme za Vaši rezervaci školící místnosti. Vaši žádost jsme úspěšně přijali a brzy Vás budeme telefonicky kontaktovat pro potvrzení všech detailů."
          : "Thank you for your training room reservation. We have successfully received your request and will contact you by phone soon to confirm all details."}
      </p>

      <div
        style={{
          backgroundColor: "#e8f5e9",
          border: "1px solid #4caf50",
          borderRadius: "4px",
          padding: "15px",
          margin: "20px 0",
        }}
      >
        <p style={{ color: "#2e7d32", margin: 0 }}>
          <strong>
            {locale === "cs-CZ" ? "Co bude následovat:" : "What's next:"}
          </strong>
          <br />
          {locale === "cs-CZ"
            ? "📞 Zavoláme Vám v nejbližší pracovní době pro potvrzení rezervace a zodpovězení případných dotazů."
            : "📞 We will call you during the next business hours to confirm your reservation and answer any questions."}
        </p>
      </div>

      <h3 style={subheadingStyle}>
        {locale === "cs-CZ" ? "Detaily rezervace:" : "Reservation Details:"}
      </h3>
      <table style={tableStyle}>
        <tbody>
          <BoardgameEmailRow
            label={locale === "cs-CZ" ? "Datum:" : "Date:"}
            value={formattedDate}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={locale === "cs-CZ" ? "Čas:" : "Time:"}
            value={formattedTime}
            cellStyle={cellStyle}
          />
          <BoardgameEmailRow
            label={locale === "cs-CZ" ? "Doba trvání:" : "Duration:"}
            value={`${duration} ${durationLabel(duration, locale)}`}
            cellStyle={cellStyle}
          />
        </tbody>
      </table>

      <p style={{ marginTop: "20px" }}>
        {locale === "cs-CZ"
          ? `Pokud máte jakékoliv dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.reservationEmail}.`
          : `If you have any questions, please don't hesitate to contact us at ${siteConstants.contact.reservationEmail}.`}
      </p>

      <hr style={hrStyle} />
      <p style={footerStyle}>
        DeskoHub
        <br />
        {locale === "cs-CZ"
          ? "Váš prostor pro práci a kreativitu"
          : "Your space for work and creativity"}
      </p>
    </TrainingEmailContainer>
  );
