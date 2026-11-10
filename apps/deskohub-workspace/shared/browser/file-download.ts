/**
 * The file name a response's `Content-Disposition` header gives its
 * attachment, as `createDownloadResponse` quotes it; none without one.
 */
export const getAttachmentFileName = (response: Response): string | undefined =>
  /filename="([^"]+)"/.exec(
    response.headers.get("Content-Disposition") ?? ""
  )?.[1];

/**
 * Hands `blob` to the browser as a download named `fileName`, the way a
 * clicked `<a download>` link does. Throws when the browser can't create the
 * object URL.
 */
export const saveBlobAsFile = ({
  blob,
  fileName,
}: {
  readonly blob: Blob;
  readonly fileName: string;
}) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoking right away can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
