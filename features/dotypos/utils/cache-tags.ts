/**
 * Cache Tags for Dotypos data
 */

abstract class DotyposCacheTags {
  abstract get _tags(): Record<string, unknown>;

  constructor(private _base: string) {}

  get all() {
    return `all-${this._base}`;
  }

  get cacheTags(): string[] {
    return [
      this.all,
      ...Object.keys(this._tags)
        .map((tag) => this._constructTag(tag))
        .filter(Boolean),
    ];
  }

  _constructTag(name: keyof typeof this._tags) {
    if (!name) return null;
    const value = this._tags[name];
    if (value === null || value === undefined) return null;
    return `${this._base}-${value}`;
  }
}

export class DotyposReservationCacheTags extends DotyposCacheTags {
  _tags: Partial<{
    reservationId: string;
    customerId: string;
  }> = {};

  constructor(options: { reservationId?: string; customerId?: string }) {
    super("dotypos-reservations");
    this._tags.reservationId = options.reservationId;
    this._tags.customerId = options.customerId;
  }

  get reservation() {
    return this._constructTag("reservationId");
  }

  get customer() {
    return this._constructTag("customerId");
  }
}

export class DotyposCustomerCacheTags extends DotyposCacheTags {
  _tags: Partial<{
    customerId: string;
    email: string;
    phone: string;
  }> = {};

  constructor(options: {
    customerId?: string;
    email?: string;
    phone?: string;
  }) {
    super("dotypos-customers");
    this._tags.customerId = options.customerId;
    this._tags.email = options.email;
    this._tags.phone = options.phone;
  }

  get customer() {
    return this._constructTag("customerId");
  }

  get email() {
    return this._constructTag("email");
  }

  get phone() {
    return this._constructTag("phone");
  }
}

export class DotyposMenuCacheTags extends DotyposCacheTags {
  _tags: Partial<{
    categoryId: string;
    includeDeleted: boolean;
  }> = {};

  constructor(options?: { categoryId?: string; includeDeleted?: boolean }) {
    super("dotypos-menu");
    if (options?.categoryId) {
      this._tags.categoryId = options.categoryId;
    }
    if (options?.includeDeleted !== undefined) {
      this._tags.includeDeleted = options.includeDeleted;
    }
  }

  get category() {
    return this._constructTag("categoryId");
  }
}

export class DotyposTablesCacheTags extends DotyposCacheTags {
  _tags: Record<string, never> = {};

  constructor() {
    super("dotypos-tables");
  }
}
