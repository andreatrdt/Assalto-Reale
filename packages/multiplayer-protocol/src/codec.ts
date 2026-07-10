import type {
  ClientCommandEnvelope,
  ProtocolValidationError,
  ServerEventEnvelope,
  ValidationResult,
} from "./types.js";
import { validateClientMessage, validateServerMessage } from "./validation.js";

function decodeJson(raw: string): ValidationResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    const error: ProtocolValidationError = {
      code: "invalid_json",
      path: "$",
      message: "Message is not valid JSON.",
    };
    return { ok: false, error };
  }
}

export function decodeClientMessage(raw: string): ValidationResult<ClientCommandEnvelope> {
  const decoded = decodeJson(raw);
  return decoded.ok ? validateClientMessage(decoded.value) : decoded;
}

export function decodeServerMessage(raw: string): ValidationResult<ServerEventEnvelope> {
  const decoded = decodeJson(raw);
  return decoded.ok ? validateServerMessage(decoded.value) : decoded;
}

export function encodeClientMessage(message: ClientCommandEnvelope): string {
  const validated = validateClientMessage(message);
  if (!validated.ok) {
    throw new TypeError(`${validated.error.path}: ${validated.error.message}`);
  }
  return JSON.stringify(validated.value);
}

export function encodeServerMessage(message: ServerEventEnvelope): string {
  const validated = validateServerMessage(message);
  if (!validated.ok) {
    throw new TypeError(`${validated.error.path}: ${validated.error.message}`);
  }
  return JSON.stringify(validated.value);
}
