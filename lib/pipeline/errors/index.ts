/**
 * Error hierarchy for the Data Entry Agent pipeline.
 * Each phase has its own error class for targeted catch handling.
 */

export class DataEntryError extends Error {
  constructor(
    message: string,
    public readonly phase: string,
  ) {
    super(message);
    this.name = 'DataEntryError';
  }
}

export class ResolveError extends DataEntryError {
  constructor(
    message: string,
    public readonly recordId: string,
  ) {
    super(message, 'resolve');
    this.name = 'ResolveError';
  }
}

export class FetchError extends DataEntryError {
  constructor(
    message: string,
    public readonly source: string,
    public readonly statusCode?: number,
  ) {
    super(message, 'fetch');
    this.name = 'FetchError';
  }
}

export class ExtractionError extends DataEntryError {
  constructor(
    message: string,
    public readonly batchId: string,
  ) {
    super(message, 'extract');
    this.name = 'ExtractionError';
  }
}

export class ValidationError extends DataEntryError {
  constructor(
    message: string,
    public readonly fieldName: string,
    public readonly reason: string,
  ) {
    super(message, 'validate');
    this.name = 'ValidationError';
  }
}

export class WriteError extends DataEntryError {
  constructor(
    message: string,
    public readonly objectType: string,
    public readonly recordId: string,
    public readonly statusCode?: number,
  ) {
    super(message, 'write');
    this.name = 'WriteError';
  }
}
