class CustomError extends Error {}

export class StackDoesNotExistError extends CustomError {
  constructor(message = 'The stack does not exist.') {
    super(message);
    this.name = "StackDoesNotExistError";
  }
}

export class StackStillNotReady extends CustomError {
  constructor(message = 'The stack is still not ready.') {
    super(message);
    this.name = "StackStillNotReady";
  }
}

export class StackCreateError extends CustomError {
  constructor(status) {
    super(`Stack creating failed. Current status: ${status}.`);
    this.name = 'StackCreateError';
  }
}

export class SnapshotNotReadyError extends CustomError {
  constructor(message = 'DB Snapshot is not ready.') {
    super(message);
    this.name = "SnapshotNotReadyError";
  }
}

export class DatabaseInstanceNotReadyError extends CustomError {
  constructor(message = 'DB Instance is not ready.') {
    super(message);
    this.name = "DatabaseInstanceNotReadyError";
  }
}

export class DatabaseInstanceFailedError extends CustomError {
  constructor(message = 'DB Instance failed to create.') {
    super(message);
    this.name = "DatabaseInstanceFailedError";
  }
}

export class DatabaseInstanceNotDeleted extends CustomError {
  constructor(message = 'DB Instance still not deleted.') {
    super(message);
    this.name = "DatabaseInstanceNotDeleted";
  }
}