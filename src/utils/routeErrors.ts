import { StatusCodes } from "http-status-codes";

interface RouteErrorConfig {
  message: string;
  statusCode?: number;
  data?: any;
}
export default class RouteError extends Error {
  public statusCode: number;
  public data: any;

  constructor({
    message,
    statusCode = StatusCodes.INTERNAL_SERVER_ERROR,
    data = null,
  }: RouteErrorConfig) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.name = this.constructor.name; // Automatically set the error name
    Error.captureStackTrace(this, this.constructor); // Retain stack trace
  }

  // Static Methods for Specific Error Types
  static BadRequest(message: string, data: any = null): RouteError {
    return new RouteError({
      message,
      statusCode: StatusCodes.BAD_REQUEST,
      data,
    });
  }

  static Unauthorized(message: string, data: any = null): RouteError {
    return new RouteError({
      message,
      statusCode: StatusCodes.UNAUTHORIZED,
      data,
    });
  }

  static Forbidden(message: string, data: any = null): RouteError {
    return new RouteError({
      message,
      statusCode: StatusCodes.FORBIDDEN,
      data,
    });
  }

  static NotFound(message: string, data: any = null): RouteError {
    return new RouteError({
      message,
      statusCode: StatusCodes.NOT_FOUND,
      data,
    });
  }

  static InternalServerError(message: string, data: any = null): RouteError {
    return new RouteError({
      message,
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      data,
    });
  }
}
