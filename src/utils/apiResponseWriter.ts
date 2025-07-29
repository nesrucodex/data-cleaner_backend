import { Response } from "express";
import { APIResponse } from "../types";

type APIResponseWriter<T> = {
  res: Response;
  statusCode: number;
  success: boolean;
  message: string;
  data?: T;
  error?: any;
};

const APIResponseWriter = <T>({
  res,
  statusCode,
  success,
  message,
  data,
  error,
}: APIResponseWriter<T>) => {
  if (success) {
    res.status(statusCode).json({
      success,
      message,
      data,
    } satisfies Omit<APIResponse<T>, "error">);
  } else if (error) {
    res.status(statusCode).json({
      success,
      message,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    } satisfies Omit<APIResponse<T>, "data">);
  } else {
    res.status(statusCode).json({
      success,
      message,
      data,
    } satisfies Omit<APIResponse<T>, "error">);
  }
};

export { APIResponseWriter };
export default APIResponseWriter;
