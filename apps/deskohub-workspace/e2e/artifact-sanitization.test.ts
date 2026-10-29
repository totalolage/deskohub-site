import { expect, test } from "bun:test";
import { sanitizeHarArtifact } from "./artifact-sanitization";
import { addRedaction } from "./redaction";

test("keeps a sanitized HAR valid JSON when a short value is redacted", () => {
  addRedaction("97531", true);
  const sanitized = JSON.parse(
    sanitizeHarArtifact(
      JSON.stringify({
        log: {
          entries: [
            {
              comment: "card 97531",
              request: {
                bodySize: 97531,
                headers: [{ name: "Cookie", value: "session" }],
                postData: { params: [{ name: "pan" }], text: "97531" },
                url: "https://pay.example.test/fe/build/text/?token=abc",
              },
              response: {
                content: { text: '{"errors":[]}' },
                headers: [],
              },
              time: 5.97531,
            },
          ],
        },
      })
    )
  );
  const [entry] = sanitized.log.entries;

  expect(entry.time).toBe("5.[redacted]");
  expect(entry.request.bodySize).toBe("[redacted]");
  expect(JSON.stringify(sanitized)).not.toContain("97531");
  expect(entry.comment).toBe("card [redacted]");
  expect(entry.request.headers).toEqual([
    { name: "Cookie", value: "[redacted]" },
  ]);
  expect(entry.request.postData).toEqual({ params: [], text: "[redacted]" });
  expect(entry.request.url).not.toContain("abc");
  expect(entry.response.content.text).toBe("[redacted]");
});

test("keeps only the error codes of a failed Nexi hosted-field response", () => {
  const cardDataUrl = "https://xpaysandbox.nexigroup.com/fe/build/text/";
  const harEntry = (url: string, status: number, text: string) => ({
    request: { headers: [], url },
    response: { content: { text }, headers: [], status },
  });
  const sanitized = JSON.parse(
    sanitizeHarArtifact(
      JSON.stringify({
        log: {
          entries: [
            harEntry(
              cardDataUrl,
              400,
              JSON.stringify({
                errors: [
                  { code: "GW0001", description: "Jane Doe is not allowed" },
                  { code: "298" },
                  { code: "JANE" },
                ],
                event: "JANE",
                fieldStatus: [
                  { event: "BUILD_ERROR", id: "CARDHOLDER_NAME" },
                  { event: "BUILD_ERROR", id: "A1B2C3D4E5F6" },
                  { event: "1234", id: "CARD_NUMBER" },
                ],
                holder: "Jane Doe",
                pan: 4509,
                workflowState: "CARD_DATA_COLLECTION",
              })
            ),
            harEntry(cardDataUrl, 400, '"GW0001"'),
            harEntry(cardDataUrl, 400, '["298", "GW0001"]'),
            harEntry(cardDataUrl, 400, "<html>Jane Doe</html>"),
            harEntry(
              cardDataUrl,
              200,
              '{"workflowState":"CARD_DATA_COLLECTION"}'
            ),
            harEntry(
              "https://deskohub.example.test/fe/build/text/",
              400,
              '{"errors":[{"code":"GW0001"}]}'
            ),
          ],
        },
      })
    )
  );
  const [nexiFailure, ...redactedEntries] = sanitized.log.entries;

  expect(JSON.parse(nexiFailure.response.content.text)).toEqual({
    errors: [{ code: "GW0001" }],
    fieldStatus: [
      { event: "BUILD_ERROR", id: "CARDHOLDER_NAME" },
      { event: "BUILD_ERROR", id: "[other]" },
    ],
    workflowState: "CARD_DATA_COLLECTION",
  });
  for (const entry of redactedEntries)
    expect(entry.response.content.text).toBe("[redacted]");
});

// Sanitizing is idempotent: the session's close sanitizes the HAR once, the
// argv failure capture it replaced sanitized that copy again, and both export
// the same HAR.
test("leaves an already sanitized HAR unchanged", () => {
  addRedaction("86420", true);
  addRedaction("synthetic-bypass-secret");
  const once = sanitizeHarArtifact(
    JSON.stringify({
      log: {
        entries: [
          {
            request: {
              headers: [
                {
                  name: "x-vercel-protection-bypass",
                  value: "synthetic-bypass-secret",
                },
              ],
              queryString: [{ name: "orderId", value: "86420" }],
              url: "https://workspace.example.test/en-US/reservation/status?orderId=86420&payState=ok",
            },
            response: {
              content: { text: '{"orderId":"86420"}' },
              headers: [{ name: "set-cookie", value: "session=abc" }],
              redirectURL:
                "https://workspace.example.test/next?token=synthetic-bypass-secret",
              status: 200,
            },
            time: 8.642,
          },
          {
            request: {
              headers: [],
              url: "https://xpaysandbox.nexigroup.com/fe/build/text/",
            },
            response: {
              content: {
                text: JSON.stringify({
                  errors: [{ code: "GW0001" }],
                  workflowState: "CARD_DATA_COLLECTION",
                }),
              },
              headers: [],
              status: 400,
            },
          },
        ],
      },
    })
  );

  expect(sanitizeHarArtifact(once)).toBe(once);
  expect(sanitizeHarArtifact("not json 86420 ?token=abc")).toBe(
    sanitizeHarArtifact(sanitizeHarArtifact("not json 86420 ?token=abc"))
  );
});
