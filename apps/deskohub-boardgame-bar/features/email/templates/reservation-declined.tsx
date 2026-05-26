import type { ReservationConfirmationData } from "@deskohub/email/types/email.types";
import { renderBoardgameEmailDocument } from "@/features/email/backend/email-rendering";
import type { Locale } from "@/features/i18n";
import { siteConstants } from "@/shared/utils/constants";

const nextSteps = (isEnglish: boolean) =>
  isEnglish
    ? [
        "You can make a new reservation at any time through our website",
        "If you have questions about the cancellation, please contact us",
        "We apologize for any inconvenience",
      ]
    : [
        "Novou rezervaci můžete provést kdykoliv přes naše webové stránky",
        "Pokud máte dotazy ohledně zrušení, kontaktujte nás",
        "Omlouváme se za případné nepříjemnosti",
      ];

/**
 * Email template for declined/cancelled reservations
 */
export function renderReservationDeclinedEmail(
  data: ReservationConfirmationData,
  locale: Locale
) {
  const isEnglish = locale.startsWith("en");

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: siteConstants.workingHours.timezone,
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: siteConstants.workingHours.timezone,
    });
  };

  const subject = isEnglish
    ? `Reservation Cancelled - ${formatDate(data.datetime)}`
    : `Rezervace zrušena - ${formatDate(data.datetime)}`;

  const html = renderBoardgameEmailDocument(
    <html lang={locale}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          lineHeight: 1.6,
          color: "#333",
          maxWidth: "600px",
          margin: "0 auto",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
            padding: "30px",
            borderRadius: "10px 10px 0 0",
            textAlign: "center",
          }}
        >
          <div
            style={{
              background: "white",
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              margin: "0 auto 15px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              aria-hidden="true"
              focusable="false"
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <h1 style={{ color: "white", margin: 0, fontSize: "28px" }}>
            {isEnglish ? "Reservation Cancelled" : "Rezervace zrušena"}
          </h1>
        </div>

        <div
          style={{
            background: "#f9f9f9",
            padding: "30px",
            borderRadius: "0 0 10px 10px",
          }}
        >
          <p style={{ fontSize: "16px", marginBottom: "20px" }}>
            {isEnglish
              ? `Dear ${data.customerName},`
              : `Vážený/á ${data.customerName},`}
          </p>
          <p style={{ fontSize: "16px", marginBottom: "20px" }}>
            {isEnglish
              ? "We regret to inform you that your reservation has been cancelled. This could be due to unavailability or other circumstances."
              : "S lítostí vám oznamujeme, že vaše rezervace byla zrušena. Může to být z důvodu nedostupnosti nebo jiných okolností."}
          </p>

          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              margin: "20px 0",
              border: "1px solid #fee2e2",
            }}
          >
            <h2 style={{ color: "#dc2626", marginTop: 0 }}>
              {isEnglish
                ? "Cancelled Reservation Details"
                : "Detaily zrušené rezervace"}
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <strong>
                      {isEnglish ? "Reservation ID:" : "ID rezervace:"}
                    </strong>
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                      fontFamily: "monospace",
                      textDecoration: "line-through",
                    }}
                  >
                    #{data.reservationId}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <strong>
                      {isEnglish ? "Original Date:" : "Původní datum:"}
                    </strong>
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    {formatDate(data.datetime)}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <strong>
                      {isEnglish ? "Original Time:" : "Původní čas:"}
                    </strong>
                  </td>
                  <td
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    {formatTime(data.datetime)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "10px 0" }}>
                    <strong>
                      {isEnglish ? "Number of Guests:" : "Počet hostů:"}
                    </strong>
                  </td>
                  <td style={{ padding: "10px 0" }}>{data.guestCount}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            style={{
              background: "#fef2f2",
              padding: "15px",
              borderRadius: "8px",
              margin: "20px 0",
              borderLeft: "4px solid #ef4444",
            }}
          >
            <p style={{ margin: 0, color: "#991b1b" }}>
              <strong>{isEnglish ? "What's Next?" : "Co dál?"}</strong>
              {nextSteps(isEnglish).map((line) => (
                <span key={line}>
                  <br />• {line}
                </span>
              ))}
            </p>
          </div>

          {data.reservationUrl ? (
            <div style={{ textAlign: "center", margin: "30px 0" }}>
              <a
                href={data.reservationUrl.toString()}
                style={{
                  display: "inline-block",
                  background: "#3b82f6",
                  color: "white",
                  padding: "12px 30px",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                }}
              >
                {isEnglish
                  ? "Make a New Reservation"
                  : "Vytvořit novou rezervaci"}
              </a>
            </div>
          ) : null}

          <div
            style={{
              marginTop: "30px",
              paddingTop: "20px",
              borderTop: "1px solid #ddd",
            }}
          >
            <h3 style={{ color: "#333" }}>
              {isEnglish ? "Need Help?" : "Potřebujete pomoc?"}
            </h3>
            <p style={{ fontSize: "14px", color: "#666" }}>
              {isEnglish
                ? `If you have any questions about this cancellation or would like to discuss alternative dates, please contact us at ${siteConstants.contact.infoEmail} or call ${siteConstants.contact.phone}`
                : `Pokud máte jakékoliv dotazy ohledně tohoto zrušení nebo byste chtěli projednat alternativní termíny, kontaktujte nás na ${siteConstants.contact.infoEmail} nebo volejte ${siteConstants.contact.phone}`}
            </p>
          </div>

          <p style={{ fontSize: "16px", marginTop: "30px" }}>
            {isEnglish
              ? "We hope to see you soon!"
              : "Doufáme, že se brzy uvidíme!"}
            <br />
            <strong>DeskoHub Team</strong>
          </p>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "20px",
            color: "#999",
            fontSize: "14px",
          }}
        >
          <p>
            DeskoHub
            <br />
            {isEnglish
              ? "Board Game Bar & Coworking Space"
              : "Deskové hry & Coworking"}
            <br />📍 Prague, Czech Republic
            <br />📧 {siteConstants.contact.infoEmail} | 📞{" "}
            {siteConstants.contact.phone}
          </p>
        </div>
      </body>
    </html>
  );

  const text = isEnglish
    ? `Reservation Cancelled

Dear ${data.customerName},

We regret to inform you that your reservation has been cancelled. This could be due to unavailability or other circumstances.

Cancelled Reservation Details:
- Reservation ID: #${data.reservationId} (CANCELLED)
- Original Date: ${formatDate(data.datetime)}
- Original Time: ${formatTime(data.datetime)}
- Number of Guests: ${data.guestCount}

What's Next?
• You can make a new reservation at any time through our website
• If you have questions about the cancellation, please contact us
• We apologize for any inconvenience

Need Help?
If you have any questions about this cancellation or would like to discuss alternative dates, please contact us at ${siteConstants.contact.infoEmail} or call ${siteConstants.contact.phone}

We hope to see you soon!
DeskoHub Team

DeskoHub - Board Game Bar & Coworking Space
Prague, Czech Republic
${siteConstants.contact.infoEmail} | ${siteConstants.contact.phone}`
    : `Rezervace zrušena

Vážený/á ${data.customerName},

S lítostí vám oznamujeme, že vaše rezervace byla zrušena. Může to být z důvodu nedostupnosti nebo jiných okolností.

Detaily zrušené rezervace:
- ID rezervace: #${data.reservationId} (ZRUŠENO)
- Původní datum: ${formatDate(data.datetime)}
- Původní čas: ${formatTime(data.datetime)}
- Počet hostů: ${data.guestCount}

Co dál?
• Novou rezervaci můžete provést kdykoliv přes naše webové stránky
• Pokud máte dotazy ohledně zrušení, kontaktujte nás
• Omlouváme se za případné nepříjemnosti

Potřebujete pomoc?
Pokud máte jakékoliv dotazy ohledně tohoto zrušení nebo byste chtěli projednat alternativní termíny, kontaktujte nás na ${siteConstants.contact.infoEmail} nebo volejte ${siteConstants.contact.phone}

Doufáme, že se brzy uvidíme!
DeskoHub Team

DeskoHub - Deskové hry & Coworking
Praha, Česká republika
${siteConstants.contact.infoEmail} | ${siteConstants.contact.phone}`;

  return { subject, html, text };
}
