export class AppError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
