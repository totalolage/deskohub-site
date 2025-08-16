export class BackendError {
  readonly _tag: string = "BackendError";
  constructor(
    readonly code: string,
    readonly message: string,
    readonly details?: unknown
  ) {}
}

export class StorageError extends BackendError {
  override readonly _tag = "StorageError" as const;
  constructor(message: string, operation?: string) {
    super("STORAGE_ERROR", message, { operation });
  }
}

export class ValidationError extends BackendError {
  override readonly _tag = "ValidationError" as const;
  constructor(message: string, field?: string) {
    super("VALIDATION_ERROR", message, { field });
  }
}

export class ExternalAPIError extends BackendError {
  override readonly _tag = "ExternalAPIError" as const;
  constructor(service: string, message: string, statusCode?: number) {
    super("EXTERNAL_API_ERROR", message, { service, statusCode });
  }
}

export class NetworkError extends BackendError {
  override readonly _tag = "NetworkError" as const;
  constructor(message: string, url?: string) {
    super("NETWORK_ERROR", message, { url });
  }
}

export class ParseError extends BackendError {
  override readonly _tag = "ParseError" as const;
  constructor(message: string, data?: unknown) {
    super("PARSE_ERROR", message, { data });
  }
}
