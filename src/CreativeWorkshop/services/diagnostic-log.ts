import { CREATIVE_WORKSHOP_CLIENT_VERSION, CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION } from '../version';

function stringifyDiagnosticPayload(payload: unknown) {
  try {
    return JSON.stringify(payload, (_key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message };
      }
      if (typeof value === 'bigint') return String(value);
      return value;
    });
  } catch (error) {
    return JSON.stringify({
      clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
      diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}

function formatDiagnosticLine(event: string, payload?: unknown) {
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? {
          ...(payload as Record<string, unknown>),
          clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
          diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
        }
      : {
          clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
          diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
          data: payload ?? null,
        };

  return `[CreativeWorkshop][diag] ${event} ${stringifyDiagnosticPayload(body)}`;
}

export function creativeWorkshopDiag(event: string, payload?: unknown) {
  console.info(formatDiagnosticLine(event, payload));
}

export function creativeWorkshopDiagError(event: string, payload?: unknown) {
  console.error(formatDiagnosticLine(event, payload));
}
