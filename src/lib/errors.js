export class CapabilityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CapabilityError';
    this.details = details;
  }
}

export class SafetyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SafetyError';
    this.details = details;
  }
}

export function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    ...(error?.details ? { details: error.details } : {})
  };
}
