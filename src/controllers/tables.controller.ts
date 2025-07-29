import { StatusCodes } from "http-status-codes";
import prisma from "../config/db";
import APIResponseWriter from "../utils/apiResponseWriter";
import expressAsyncWrapper from "../utils/asyncHandler";
import { queryValidation } from "../validations";
import zodErrorFmt from "../utils/zodErrorFmt";
import { TABLES } from "../constants";

// Define a type for models that have findMany
type FindManyModel = {
  findMany: (args: any) => Promise<any>;
};

export const getPaginatedTableController = expressAsyncWrapper(
  async (req, res) => {
    const allowedTables = TABLES;

    const validationResult = queryValidation.safeParse(req.query);
    if (!validationResult.success) {
      return APIResponseWriter({
        res,
        success: false,
        message: "Invalid query parameters",
        statusCode: StatusCodes.BAD_REQUEST,
        error: zodErrorFmt(validationResult.error),
      });
    }

    const { page, limit } = validationResult.data;
    const tableName = req.params.tableName as (typeof allowedTables)[number];

    if (!allowedTables.includes(tableName)) {
      return APIResponseWriter({
        res,
        success: false,
        message: "Table not allowed or does not exist",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    const table = (prisma as unknown as Record<string, FindManyModel>)[
      tableName
    ];

    if (!table || typeof table.findMany !== "function") {
      return APIResponseWriter({
        res,
        success: false,
        message: "Model does not support findMany",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    const results = await table.findMany({
      skip: (page - 1) * limit,
      take: limit,
    });

    return APIResponseWriter({
      res,
      success: true,
      message: `${tableName} retrieved successfully`,
      statusCode: StatusCodes.OK,
      data: { [tableName]: results },
    });
  }
);
