import { CompatibilityError } from "./errors.js";

export type Validator<T> = (value: unknown, path?: string) => T;
/**
 * Validates that an unknown value is a string.
 */
export const text: Validator<string> = (v, p = "value") => {
  if (typeof v !== "string") throw new CompatibilityError(p);
  return v;
};

/**
 * Validates that an unknown value is a finite number.
 */
export const number: Validator<number> = (v, p = "value") => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new CompatibilityError(p);
  return v;
};

/**
 * Validates that an unknown value is a boolean.
 */
export const boolean: Validator<boolean> = (v, p = "value") => {
  if (typeof v !== "boolean") throw new CompatibilityError(p);
  return v;
};

/**
 * Validates that an unknown value is a non-null, non-array object record.
 */
export const record: Validator<Record<string, unknown>> = (v, p = "value") => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CompatibilityError(p);
  return v as Record<string, unknown>;
};

/**
 * Creates a validator that validates an array of items.
 */
export function array<T>(validate: Validator<T>): Validator<T[]> {
  return (v, p = "value") => {
    if (!Array.isArray(v)) throw new CompatibilityError(p);
    return v.map((item, i) => validate(item, `${p}[${i}]`));
  };
}

/**
 * Creates a validator that allows undefined or delegates to the underlying validator.
 */
export function optional<T>(validate: Validator<T>): Validator<T | undefined> {
  return (v, p) => v === undefined ? undefined : validate(v, p);
}

/**
 * Creates a validator that allows null or delegates to the underlying validator.
 */
export function nullable<T>(validate: Validator<T>): Validator<T | null> {
  return (v, p) => v === null ? null : validate(v, p);
}

/**
 * Creates a validator that expects an exact literal value.
 */
export function literal<T extends string | boolean>(expected: T): Validator<T> {
  return (v, p = "value") => { if (v !== expected) throw new CompatibilityError(p); return expected; };
}

/**
 * Creates a validator for a closed set of string values.
 *
 * Used only for fields whose server contract is an enum (alert status,
 * severity, delivery channel). Open-ended status codes keep using `text`.
 */
export function oneOf<T extends string>(expected: readonly T[]): Validator<T> {
  return (v, p = "value") => {
    if (typeof v !== "string" || !expected.includes(v as T)) throw new CompatibilityError(p);
    return v as T;
  };
}

/**
 * Creates an object shape validator validating all specified fields while preserving unknown additive fields.
 */
export function shape<S extends Record<string, Validator<unknown>>>(fields: S): Validator<{ [K in keyof S]: ReturnType<S[K]> } & Record<string, unknown>> {
  return (value, path = "response") => {
    const obj = record(value, path);
    for (const [key, validate] of Object.entries(fields)) validate(obj[key], `${path}.${key}`);
    return obj as { [K in keyof S]: ReturnType<S[K]> } & Record<string, unknown>;
  };
}
