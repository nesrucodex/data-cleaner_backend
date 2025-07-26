import { StatusCodes } from "http-status-codes";
import APIResponseWriter from "../utils/apiResponseWriter";
import expressAsyncWrapper from "../utils/asyncHandler";

export const publicApiIndexController = expressAsyncWrapper(async (_, res) => {
  const baseUrl = "/api/v1";

  const endpoints = [
    {
      path: `${baseUrl}/health`,
      method: "GET",
      description: "Check API and database health status",
    },
    // Add more as your public routes grow
  ];

  return APIResponseWriter({
    res,
    statusCode: StatusCodes.OK,
    success: true,
    message: "Public API endpoints",
    data: {
      timestamp: new Date().toISOString(),
      availableEndpoints: endpoints,
    },
  });
});
