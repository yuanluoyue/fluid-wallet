/**
 * Error codes used on the wire.
 *
 * `-326xx` mirror JSON-RPC 2.0. `41xx` are wallet state / authorization
 * failures, `42xx` are inference and quota failures. Codes are part of the
 * protocol: never renumber a published one.
 */
export const FluidErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,

  NotInstalled: 4100,
  Locked: 4101,
  Unauthorized: 4102,
  PermissionDenied: 4103,
  SessionNotFound: 4104,
  SessionExpired: 4105,
  ModelNotAllowed: 4106,
  ProviderUnavailable: 4107,
  OriginMismatch: 4108,
  Rejected: 4109,

  RateLimited: 4200,
  BudgetExceeded: 4201,
  InferenceFailed: 4202,
  InferenceCancelled: 4203,
  Timeout: 4204,
  PayloadTooLarge: 4205,
} as const satisfies Record<string, number>;

export type FluidErrorCode = (typeof FluidErrorCode)[keyof typeof FluidErrorCode];

/** Serializable error payload carried inside a `FluidResponse`. */
export interface FluidErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** Typed error thrown by the SDK and by the trusted runtime. */
export class FluidError extends Error {
  override readonly name = "FluidError";

  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }

  static from(shape: FluidErrorShape): FluidError {
    return new FluidError(shape.code, shape.message, shape.data);
  }

  static is(value: unknown, code?: number): value is FluidError {
    if (!(value instanceof FluidError)) return false;
    return code === undefined || value.code === code;
  }

  toJSON(): FluidErrorShape {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
}

export function isFluidErrorShape(value: unknown): value is FluidErrorShape {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FluidErrorShape>;
  return typeof candidate.code === "number" && typeof candidate.message === "string";
}
