import { join } from "node:path";
import type { Customer } from "@deskohub/dotypos/generated";
import type { NetworkError } from "@deskohub/email/backend/network-error";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type {
  EmailAttachment,
  EmailMessage,
  EmailRecipient,
} from "@deskohub/email/types/email.types";
import { generateQrCodePngBuffer } from "@deskohub/qr-code";
import { Context, Effect, Layer } from "effect";
import { generateSvgPngBuffer, type SvgPngTextOverlay } from "osm";
import { env } from "@/env";
import {
  createWorkspaceCheckoutWifiQrPayload,
  type WorkspaceCheckoutNetworkDetails,
  WorkspaceCheckoutNetworkDetailsService,
  workspaceCheckoutPlaceholderNetworkDetails,
} from "@/features/checkout/backend/network-details.service";
import {
  WorkspaceTableMapView,
  workspaceTableMapImageHeight,
  workspaceTableMapImageWidth,
  workspaceTableMapLabelWidth,
} from "@/features/checkout/components/workspace-table-map-view";
import {
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { WorkspaceTableMap } from "@/features/checkout/workspace-table-map";
import { isLocale, type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";
import {
  type EmailDetailRow,
  renderEmailRowsText,
  renderWorkspaceEmailHtml,
  WorkspaceEmailRows,
} from "@/shared/backend/email/rendering";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapImagePath,
  workspaceSiteConstants,
} from "@/shared/utils";

export interface WorkspaceReservationEmailService {
  readonly sendPaidReservationEmails: (input: {
    readonly reservation: WorkspaceReservationDetails;
  }) => Effect.Effect<void, EmailServiceError | NetworkError>;
}

export const WorkspaceReservationEmailService =
  Context.Service<WorkspaceReservationEmailService>(
    "WorkspaceReservationEmailService"
  );

const workspaceRecipient: EmailRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
};

const getReservationLocale = (locale: string): Locale =>
  isLocale(locale) ? locale : "cs-CZ";

const getCustomerName = (customer: Customer) =>
  [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") ||
  customer.companyName?.trim() ||
  customer.email?.trim() ||
  "Workspace customer";

const workspaceLocationMapContentId = "workspace-location-map";
const workspaceNetworkQrContentId = "workspace-wifi-qr";
const workspaceTableMapContentId = "workspace-table-map";
export const workspaceTableMapPngFontFamily = "Sculpin Variable Light";
export const workspaceTableMapFontFile = join(
  process.cwd(),
  "assets/fonts/Sculpin/regular.ttf"
);
const internalTestingSubjectPrefix = "[TESTING]";
const internalNotificationLocale: Locale = "cs-CZ";

const customerAccessHeadingDateFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Prague",
} satisfies Intl.DateTimeFormatOptions;

const formatCustomerAccessHeadingDate = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  new Intl.DateTimeFormat(
    locale,
    customerAccessHeadingDateFormatOptions
  ).format(reservation.reservedFrom);

const createCustomerAccessHeading = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  m.checkoutEmailCustomerAccessHeading(
    { date: formatCustomerAccessHeadingDate(reservation, locale) },
    { locale }
  );

const createInternalReservationSubject = (
  reservation: WorkspaceReservationDetails
) => {
  const subject = m.checkoutEmailInternalPaidReservationSubject(
    { orderId: reservation.id },
    { locale: internalNotificationLocale }
  );

  if (env.VERCEL_ENV === "production") {
    return subject;
  }

  return `${internalTestingSubjectPrefix} ${subject}`;
};

const createWorkspaceLocationMapAttachment = (): Effect.Effect<
  EmailAttachment,
  EmailServiceError
> =>
  Effect.tryPromise({
    try: async () => ({
      content: await generateWorkspaceLocationMapImage(),
      contentId: workspaceLocationMapContentId,
      contentType: "image/jpeg",
      filename: workspaceLocationMapImagePath.slice(1),
    }),
    catch: (cause) =>
      new EmailServiceError(
        "Workspace reservation location map could not be generated.",
        cause
      ),
  });

const createWorkspaceNetworkQrAttachment = (
  networkDetails: WorkspaceCheckoutNetworkDetails
): Effect.Effect<EmailAttachment, EmailServiceError> =>
  Effect.tryPromise({
    try: async () => ({
      content: await generateQrCodePngBuffer(
        createWorkspaceCheckoutWifiQrPayload(networkDetails),
        {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 280,
        }
      ),
      contentId: workspaceNetworkQrContentId,
      contentType: "image/png",
      filename: "workspace-wifi-qr.png",
    }),
    catch: (cause) =>
      new EmailServiceError(
        "Workspace reservation Wi-Fi QR code could not be generated.",
        cause
      ),
  });

const createWorkspaceTableMapPng = (
  tableMap: WorkspaceTableMap,
  locale: Locale
) => {
  const svg = renderWorkspaceEmailHtml(
    <WorkspaceTableMapView
      ariaLabel={m.checkoutStatusTableMapTitle({}, { locale })}
      tableMap={tableMap}
    />
  );

  return generateSvgPngBuffer(removeSvgTextElements(svg), {
    textOverlays: createWorkspaceTableMapTextOverlays(svg),
  });
};

const svgTextElementPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

const removeSvgTextElements = (svg: string) =>
  svg.replace(svgTextElementPattern, "");

const createWorkspaceTableMapTextOverlays = (
  svg: string
): readonly SvgPngTextOverlay[] => {
  const viewBox = getSvgViewBox(svg);
  if (!viewBox) return [];

  const scale = Math.min(
    workspaceTableMapImageWidth / viewBox.width,
    workspaceTableMapImageHeight / viewBox.height
  );
  const offsetX = (workspaceTableMapImageWidth - viewBox.width * scale) / 2;
  const offsetY = (workspaceTableMapImageHeight - viewBox.height * scale) / 2;

  return [...svg.matchAll(svgTextElementPattern)].flatMap((match) => {
    const attributes = match[1] ?? "";
    const text = decodeSvgText(match[2] ?? "");
    const x = Number(getSvgAttribute(attributes, "x"));
    const y = Number(getSvgAttribute(attributes, "y"));
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return [];

    const style = getSvgAttribute(attributes, "style") ?? "";
    const fontSize = parseSvgSize(getSvgStyleValue(style, "font-size")) ?? 15;
    const color = getSvgStyleValue(style, "fill") ?? "#00024f";

    return [
      {
        text,
        x: offsetX + (x - viewBox.x) * scale,
        y: offsetY + (y - viewBox.y) * scale,
        width: Math.ceil(workspaceTableMapLabelWidth * scale),
        font: `${workspaceTableMapPngFontFamily} ${Math.max(1, Math.round(fontSize * scale))}`,
        fontfile: workspaceTableMapFontFile,
        color,
      },
    ];
  });
};

const getSvgViewBox = (svg: string) => {
  const values = svg
    .match(/\bviewBox="([^"]+)"/)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  if (values?.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }

  const [
    x = Number.NaN,
    y = Number.NaN,
    width = Number.NaN,
    height = Number.NaN,
  ] = values;
  if (width <= 0 || height <= 0) return undefined;

  return { x, y, width, height };
};

const getSvgAttribute = (attributes: string, name: string) =>
  attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

const getSvgStyleValue = (style: string, property: string) =>
  style.match(new RegExp(`${property}\\s*:\\s*([^;]+)`))?.[1]?.trim();

const parseSvgSize = (value: string | undefined) => {
  const size = Number.parseFloat(value ?? "");

  return Number.isFinite(size) ? size : undefined;
};

const decodeSvgText = (text: string) =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");

const createWorkspaceTableMapAttachment = (
  tableMap: WorkspaceTableMap,
  locale: Locale
): Effect.Effect<EmailAttachment, EmailServiceError> =>
  Effect.tryPromise({
    try: async () => ({
      content: await createWorkspaceTableMapPng(tableMap, locale),
      contentId: workspaceTableMapContentId,
      contentType: "image/png",
      filename: "workspace-table-map.png",
    }),
    catch: (cause) =>
      new EmailServiceError(
        "Workspace reservation table map could not be generated.",
        cause
      ),
  });

const createReservationDetailRows = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
): EmailDetailRow[] => {
  const monitorOption = reservation.productMonitorOption ?? undefined;
  const rows: EmailDetailRow[] = [
    [
      m.reservationEmailDateLabel({}, { locale }),
      formatReservationDisplayDate(reservation.reservedFrom, locale),
    ],
    [
      m.reservationEmailTierLabel({}, { locale }),
      isWorkspaceProductTier(reservation.productTier)
        ? getWorkspaceProductTierTitle(reservation.productTier, locale)
        : reservation.productTier,
    ],
    [
      m.reservationEmailCoffeeLabel({}, { locale }),
      reservation.productCoffee
        ? m.checkoutStatusYes({}, { locale })
        : m.checkoutStatusNo({}, { locale }),
    ],
  ];

  if (isWorkspaceProductMonitorOption(monitorOption)) {
    rows.splice(2, 0, [
      m.reservationEmailMonitorsLabel({}, { locale }),
      getWorkspaceProductMonitorTitle(monitorOption, locale),
    ]);
  }

  return rows;
};

const appendReservationReferenceRows = (
  rows: EmailDetailRow[],
  reservation: WorkspaceReservationDetails,
  locale: Locale
) => {
  if (reservation.dotyposReservationId) {
    rows.push([
      m.checkoutEmailDotyposReservationIdLabel({}, { locale }),
      reservation.dotyposReservationId,
    ]);
  }

  rows.push([m.checkoutStatusOrderIdLabel({}, { locale }), reservation.id]);
};

export const createReservationRows = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
): EmailDetailRow[] => {
  const rows = createReservationDetailRows(reservation, locale);

  appendReservationReferenceRows(rows, reservation, locale);

  return rows;
};

const createInternalReservationRows = (
  reservation: WorkspaceReservationDetails,
  customer: Customer,
  locale: Locale
): EmailDetailRow[] => {
  const customerEmail = customer.email?.trim();
  const rows: EmailDetailRow[] = [
    [m.reservationEmailNameLabel({}, { locale }), getCustomerName(customer)],
  ];

  if (customerEmail) {
    rows.push([m.reservationEmailEmailLabel({}, { locale }), customerEmail]);
  }

  if (customer.phone?.trim()) {
    rows.push([m.reservationEmailPhoneLabel({}, { locale }), customer.phone]);
  }

  rows.push(...createReservationDetailRows(reservation, locale));

  appendReservationReferenceRows(rows, reservation, locale);

  return rows;
};

const createEmailHtml = (input: {
  readonly heading: string;
  readonly body?: string;
  readonly locale: Locale;
  readonly accessCode?: string;
  readonly networkDetails?: WorkspaceCheckoutNetworkDetails;
  readonly networkQrImageSrc?: string;
  readonly tableName?: string;
  readonly tableMapImageSrc?: string;
  readonly locationMapContentId?: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  renderWorkspaceEmailHtml(
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        color: "#00024f",
      }}
    >
      <h2 style={{ color: "#00024f" }}>{input.heading}</h2>
      {input.body && <p>{input.body}</p>}
      {input.accessCode && (
        <div
          style={{
            margin: "18px 0 22px",
            background: "#f4f1ea",
            border: "1px solid #e6ded2",
            borderRadius: "20px",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "18px 20px" }}>
            <div
              style={{
                color: "#006b55",
                fontSize: "12px",
                fontWeight: 800,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                marginBottom: "7px",
              }}
            >
              {m.checkoutEmailLocationHeading({}, { locale: input.locale })}
            </div>
            <a
              href={workspaceGoogleDirectionsUrl}
              rel="noopener noreferrer"
              style={{
                color: "#00024f",
                display: "inline-block",
                fontSize: "17px",
                fontWeight: 700,
                lineHeight: "1.45",
                textDecoration: "none",
              }}
              target="_blank"
            >
              {workspaceFormattedAddress}
            </a>
          </div>
          {input.locationMapContentId && (
            <>
              {/* biome-ignore lint/performance/noImgElement: Email HTML needs a plain image tag. */}
              <img
                alt={m.checkoutEmailLocationHeading(
                  {},
                  { locale: input.locale }
                )}
                src={`cid:${input.locationMapContentId}`}
                style={{
                  border: 0,
                  display: "block",
                  height: "auto",
                  width: "100%",
                }}
                width="560"
              />
            </>
          )}
          <div
            style={{
              background: "#f4f1ea",
              padding: "0 20px 22px",
              textAlign: "center",
            }}
          >
            <a
              href={workspaceGoogleDirectionsUrl}
              rel="noopener noreferrer"
              style={{
                background: "#00024f",
                border: "1px solid #00024f",
                borderRadius: "999px",
                color: "#f4f1ea",
                display: "inline-block",
                fontSize: "15px",
                fontWeight: 800,
                lineHeight: "20px",
                marginTop: "-24px",
                padding: "14px 28px",
                position: "relative",
                textAlign: "center",
                textDecoration: "none",
                zIndex: 1,
              }}
              target="_blank"
            >
              {m.checkoutEmailLocationMapLink({}, { locale: input.locale })}
            </a>
          </div>
        </div>
      )}
      {input.accessCode && (
        <div
          style={{
            margin: "24px 0 18px",
            background: "#f4f1ea",
            border: "1px solid #e6ded2",
            borderRadius: "24px",
            overflow: "hidden",
            boxShadow: "0 18px 40px rgba(0, 2, 79, 0.12)",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, #00024f 0%, #06145f 58%, #004f66 100%)",
              color: "#f4f1ea",
              padding: "22px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {m.checkoutEmailAccessCodeLabel({}, { locale: input.locale })}
            </div>
            <div
              style={{
                fontSize: "64px",
                lineHeight: "1",
                fontWeight: 800,
                letterSpacing: "0.08em",
                marginTop: "10px",
              }}
            >
              {input.accessCode}
            </div>
          </div>
          {input.tableName && (
            <div
              style={{
                background: "#e9fff6",
                borderTop: "4px solid #00df99",
                color: "#00024f",
                padding: "20px 24px 24px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#00024f",
                }}
              >
                {m.checkoutEmailTableNumberLabel({}, { locale: input.locale })}
              </div>
              <div
                style={{
                  fontSize: "56px",
                  lineHeight: "1",
                  fontWeight: 800,
                  marginTop: "8px",
                }}
              >
                {input.tableName}
              </div>
              {input.tableMapImageSrc && (
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid rgba(0, 2, 79, 0.1)",
                    borderRadius: "18px",
                    margin: "16px auto 0",
                    maxWidth: "500px",
                    padding: "12px",
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: Email HTML needs a plain image tag. */}
                  <img
                    alt={m.checkoutStatusTableMapTitle(
                      {},
                      { locale: input.locale }
                    )}
                    src={input.tableMapImageSrc}
                    style={{
                      border: 0,
                      display: "block",
                      height: "auto",
                      width: "100%",
                    }}
                    width="500"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {input.networkDetails && (
        <div
          style={{
            margin: "18px 0 22px",
            background: "#eef8ff",
            border: "1px solid #cfe6f8",
            borderRadius: "20px",
            padding: "18px 20px",
          }}
        >
          <table
            role="presentation"
            style={{ borderCollapse: "collapse", width: "100%" }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    padding: input.networkQrImageSrc ? "0 18px 10px 0" : 0,
                    verticalAlign: "top",
                  }}
                >
                  <div
                    style={{
                      color: "#006b55",
                      fontSize: "12px",
                      fontWeight: 800,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                    }}
                  >
                    {m.checkoutEmailNetworkHeading(
                      {},
                      { locale: input.locale }
                    )}
                  </div>
                </td>
                {input.networkQrImageSrc && (
                  <td
                    rowSpan={2}
                    style={{
                      paddingLeft: "18px",
                      textAlign: "right",
                      verticalAlign: "middle",
                      width: "170px",
                    }}
                  >
                    {/* biome-ignore lint/performance/noImgElement: Email HTML needs a plain image tag. */}
                    <img
                      alt={m.checkoutEmailNetworkHeading(
                        {},
                        { locale: input.locale }
                      )}
                      src={input.networkQrImageSrc}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #d8edf8",
                        borderRadius: "18px",
                        display: "inline-block",
                        height: "auto",
                        padding: "10px",
                        width: "148px",
                      }}
                      width="148"
                    />
                  </td>
                )}
              </tr>
              <tr>
                <td
                  style={{
                    color: "#00024f",
                    fontSize: "16px",
                    lineHeight: 1.6,
                    paddingRight: input.networkQrImageSrc ? "18px" : 0,
                    verticalAlign: "top",
                  }}
                >
                  <div>
                    <strong>
                      {m.checkoutEmailNetworkSsidLabel(
                        {},
                        { locale: input.locale }
                      )}
                      :
                    </strong>{" "}
                    {input.networkDetails.ssid}
                  </div>
                  <div>
                    <strong>
                      {m.checkoutEmailNetworkPasswordLabel(
                        {},
                        { locale: input.locale }
                      )}
                      :
                    </strong>{" "}
                    {input.networkDetails.password}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: "16px",
        }}
      >
        <tbody>
          <WorkspaceEmailRows rows={input.rows} />
        </tbody>
      </table>
      {input.followUp && <p style={{ marginTop: "20px" }}>{input.followUp}</p>}
    </div>
  );

const createEmailText = (input: {
  readonly heading: string;
  readonly body?: string;
  readonly locale: Locale;
  readonly accessCode?: string;
  readonly networkDetails?: WorkspaceCheckoutNetworkDetails;
  readonly tableName?: string;
  readonly rows: readonly EmailDetailRow[];
  readonly followUp?: string;
}) =>
  [
    input.heading,
    ...(input.body ? ["", input.body] : []),
    ...(input.accessCode
      ? [
          "",
          m.checkoutEmailLocationHeading({}, { locale: input.locale }),
          workspaceFormattedAddress,
          workspaceGoogleDirectionsUrl,
        ]
      : []),
    ...(input.accessCode
      ? [
          "",
          `${m.checkoutEmailAccessCodeLabel({}, { locale: input.locale })}: ${input.accessCode}`,
        ]
      : []),
    ...(input.tableName
      ? [
          "",
          `${m.checkoutEmailTableNumberLabel({}, { locale: input.locale })}: ${input.tableName}`,
        ]
      : []),
    ...(input.networkDetails
      ? [
          "",
          m.checkoutEmailNetworkHeading({}, { locale: input.locale }),
          `${m.checkoutEmailNetworkSsidLabel({}, { locale: input.locale })}: ${input.networkDetails.ssid}`,
          `${m.checkoutEmailNetworkPasswordLabel({}, { locale: input.locale })}: ${input.networkDetails.password}`,
        ]
      : []),
    "",
    ...renderEmailRowsText(input.rows),
    ...(input.followUp ? ["", input.followUp] : []),
  ].join("\n");

export const createWorkspaceReservationCustomerEmailPreviewHtml =
  async (input: { readonly reservation: WorkspaceReservationDetails }) => {
    const locale = getReservationLocale(input.reservation.locale);
    const rows = createReservationRows(input.reservation, locale);
    const networkQrPng = await generateQrCodePngBuffer(
      createWorkspaceCheckoutWifiQrPayload(
        workspaceCheckoutPlaceholderNetworkDetails
      ),
      {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
      }
    );
    const tableMapPng = input.reservation.tableMap
      ? await createWorkspaceTableMapPng(input.reservation.tableMap, locale)
      : undefined;

    return createEmailHtml({
      heading: createCustomerAccessHeading(input.reservation, locale),
      locale,
      accessCode: input.reservation.customerAccessCode,
      networkDetails: workspaceCheckoutPlaceholderNetworkDetails,
      networkQrImageSrc: `data:image/png;base64,${networkQrPng.toString("base64")}`,
      tableName: input.reservation.tableName,
      tableMapImageSrc: tableMapPng
        ? `data:image/png;base64,${tableMapPng.toString("base64")}`
        : undefined,
      locationMapContentId: workspaceLocationMapContentId,
      rows,
      followUp: m.reservationEmailCustomerFollowUp(
        { email: workspaceSiteConstants.contact.infoEmail },
        { locale }
      ),
    });
  };

export const createWorkspaceReservationNotificationEmailPreviewHtml = (input: {
  readonly reservation: WorkspaceReservationDetails;
}) => {
  return createEmailHtml({
    heading: m.checkoutEmailInternalPaidReservationHeading(
      {},
      { locale: internalNotificationLocale }
    ),
    body: m.checkoutEmailInternalPaidReservationBody(
      {},
      { locale: internalNotificationLocale }
    ),
    locale: internalNotificationLocale,
    rows: createInternalReservationRows(
      input.reservation,
      input.reservation.customer,
      internalNotificationLocale
    ),
  });
};

export const WorkspaceReservationEmailServiceLive = Layer.effect(
  WorkspaceReservationEmailService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;
    const networkDetailsService = yield* WorkspaceCheckoutNetworkDetailsService;

    return WorkspaceReservationEmailService.of({
      sendPaidReservationEmails: Effect.fn(
        "workspaceReservationEmail.sendPaidReservationEmails"
      )(function* ({ reservation }) {
        const locale = getReservationLocale(reservation.locale);
        const customer = reservation.customer;
        const tableName = reservation.tableName;
        const customerName = getCustomerName(customer);
        const customerEmail = customer.email?.trim();
        const networkDetails =
          yield* networkDetailsService.resolveCustomerNetworkDetails({
            reservation,
          });
        const customerRows = createReservationRows(reservation, locale);
        const internalRows = createInternalReservationRows(
          reservation,
          customer,
          internalNotificationLocale
        );
        const metadata = {
          deploymentEnvironment: env.VERCEL_ENV,
          source: "workspace-paid-fulfillment",
          workspaceReservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          dotyposCustomerId: reservation.dotyposCustomerId,
          dotyposReservationStartDate: reservation.reservedFrom.toISOString(),
          dotyposReservationEndDate: reservation.reservedUntil.toISOString(),
        };

        if (customerEmail) {
          const locationMapAttachment =
            yield* createWorkspaceLocationMapAttachment().pipe(
              Effect.catch((cause) =>
                Effect.logWarning(
                  "Workspace reservation location map attachment skipped",
                  {
                    cause,
                    workspaceReservationId: reservation.id,
                  }
                ).pipe(Effect.as(undefined))
              )
            );
          const networkQrAttachment = yield* createWorkspaceNetworkQrAttachment(
            networkDetails
          ).pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Workspace reservation Wi-Fi QR attachment skipped",
                {
                  cause,
                  workspaceReservationId: reservation.id,
                }
              ).pipe(Effect.as(undefined))
            )
          );
          const tableMapAttachment = reservation.tableMap
            ? yield* createWorkspaceTableMapAttachment(
                reservation.tableMap,
                locale
              ).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning(
                    "Workspace reservation table map attachment skipped",
                    {
                      cause,
                      workspaceReservationId: reservation.id,
                    }
                  ).pipe(Effect.as(undefined))
                )
              )
            : undefined;
          const heading = createCustomerAccessHeading(reservation, locale);
          const followUp = m.reservationEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale }
          );
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceRecipient,
            subject: m.checkoutEmailCustomerAccessSubject({}, { locale }),
            html: createEmailHtml({
              heading,
              locale,
              accessCode: reservation.customerAccessCode,
              networkDetails,
              networkQrImageSrc: networkQrAttachment
                ? `cid:${networkQrAttachment.contentId}`
                : undefined,
              tableName,
              tableMapImageSrc: tableMapAttachment
                ? `cid:${tableMapAttachment.contentId}`
                : undefined,
              locationMapContentId: locationMapAttachment?.contentId,
              rows: customerRows,
              followUp,
            }),
            text: createEmailText({
              heading,
              locale,
              accessCode: reservation.customerAccessCode,
              networkDetails,
              tableName,
              rows: customerRows,
              followUp,
            }),
            attachments: [
              locationMapAttachment,
              tableMapAttachment,
              networkQrAttachment,
            ].filter((attachment): attachment is EmailAttachment =>
              Boolean(attachment)
            ),
            tags: ["workspace-paid-reservation-access"],
            metadata,
          };

          yield* emailService.send(customerMessage).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Workspace reservation customer email failed", {
                cause,
                workspaceReservationId: reservation.id,
              })
            ),
            Effect.asVoid
          );
        } else {
          yield* Effect.logWarning(
            "Workspace reservation customer email skipped: missing customer email",
            { workspaceReservationId: reservation.id }
          );
          return yield* Effect.fail(
            new EmailServiceError(
              "Workspace reservation customer email is missing."
            )
          );
        }

        const internalHeading = m.checkoutEmailInternalPaidReservationHeading(
          {},
          { locale: internalNotificationLocale }
        );
        const internalBody = m.checkoutEmailInternalPaidReservationBody(
          {},
          { locale: internalNotificationLocale }
        );
        const internalMessage: EmailMessage = {
          from: emailConfig.defaultFrom,
          to: workspaceRecipient,
          replyTo: customerEmail
            ? { email: customerEmail, name: customerName }
            : undefined,
          subject: createInternalReservationSubject(reservation),
          html: createEmailHtml({
            heading: internalHeading,
            body: internalBody,
            locale: internalNotificationLocale,
            rows: internalRows,
          }),
          text: createEmailText({
            heading: internalHeading,
            body: internalBody,
            locale: internalNotificationLocale,
            rows: internalRows,
          }),
          tags: ["workspace-paid-reservation-internal"],
          metadata,
        };

        yield* emailService.send(internalMessage).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Workspace reservation internal email failed", {
              cause,
              workspaceReservationId: reservation.id,
            })
          ),
          Effect.ignore
        );
      }),
    });
  })
);
