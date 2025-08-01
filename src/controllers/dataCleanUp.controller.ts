// controllers/dataCleanup.controller.ts
import { StatusCodes } from "http-status-codes";
import { dmsPrisma, entitiesPrisma } from "../config/db";
import APIResponseWriter from "../utils/apiResponseWriter";
import expressAsyncWrapper from "../utils/asyncHandler";
import { DMS_TABLES, ENTITIES_TABLES } from "../constants";
import { z } from "zod";
import { CleanResult, DataCleanupService } from "../services/azureOpenAi";
import zodErrorFmt from "../utils/zodErrorFmt";
import RouteError from "../utils/routeErrors";

// === VALIDATION SCHEMA (with pagination) ===
const cleanupBodySchema = z.object({
  db: z.enum(["dms", "entities"], {
    message: "Database must be 'dms' or 'entities'",
  }),
  table: z.string().min(1, { message: "Table name is required" }),
  keyField: z.string().optional().default("id"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(10),
  dryRun: z.boolean().optional().default(true),
});

// === TYPE SAFETY ===
type FindManyModel = {
  findMany: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  count: () => Promise<number>;
};

// === CONTROLLER ===
export const cleanupTableDataController = expressAsyncWrapper(
  async (req, res) => {
    const service = new DataCleanupService();

    // Validate input
    const validationResult = cleanupBodySchema.safeParse(req.body);
    if (!validationResult.success) {
      return APIResponseWriter({
        res,
        success: false,
        message: "Invalid request payload",
        statusCode: StatusCodes.BAD_REQUEST,
        error: zodErrorFmt(validationResult.error),
      });
    }

    const { db, table, keyField, page, limit, dryRun } = validationResult.data;

    // Validate allowed tables
    const allowedTables =
      db === "dms" ? DMS_TABLES : db === "entities" ? ENTITIES_TABLES : [];

    if (!allowedTables.includes(table)) {
      return APIResponseWriter({
        res,
        success: false,
        message: `Table '${table}' is not allowed or does not exist in '${db}' database.`,
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    // Get Prisma model
    const prismaClient = db === "dms" ? dmsPrisma : entitiesPrisma;

    const model = (prismaClient as unknown as Record<string, FindManyModel>)[
      table
    ];

    if (
      !model ||
      typeof model.findMany !== "function" ||
      typeof model.count !== "function"
    ) {
      return APIResponseWriter({
        res,
        success: false,
        message: `Table model '${table}' does not support findMany or count operations.`,
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch total count and paginated rows
    let total: number;
    let rows: Record<string, any>[];

    try {
      total = await model.count();
      rows = await model.findMany({
        skip,
        take: limit,
      });
    } catch (error) {
      return APIResponseWriter({
        res,
        success: false,
        message: `Failed to fetch data from table '${table}'.`,
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }

    if (rows.length === 0) {
      return APIResponseWriter({
        res,
        success: true,
        message: `No data found in table '${table}' on page ${page}.`,
        data: {
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
          results: [],
          sql: "-- No rows to clean",
        },
        statusCode: StatusCodes.OK,
      });
    }

    // Clean data using AI
    let results: CleanResult[];
    try {
      results = await service.cleanDataBatch(rows, keyField);
    } catch (error) {
      console.error("AI cleanup failed:", error);
      return APIResponseWriter({
        res,
        success: false,
        message: "Failed to process data cleanup. AI service may be down.",
        statusCode: StatusCodes.SERVICE_UNAVAILABLE,
      });
    }

    // Dry run: return preview with pagination
    if (dryRun) {
      const sql = service.generateUpdateSQL(table, keyField, results);

      return APIResponseWriter({
        res,
        success: true,
        message: `Cleanup preview generated for '${table}' in '${db}'.`,
        statusCode: StatusCodes.OK,
        data: {
          count: results.length,
          needsReview: results.filter((r) => r.needsReview).length,
          suggestedUpdates: results.filter(
            (r) => !r.needsReview && Object.keys(r.changes).length > 0
          ).length,
          results,
          sql,
        },
      });
    }

    // Apply changes to DB
    let updatedCount = 0;
    const errors: string[] = [];

    for (const result of results) {
      if (result.needsReview || Object.keys(result.changes).length === 0)
        continue;

      try {
        await model.update({
          where: { [keyField]: result.original[keyField] },
          data: result.cleaned,
        });
        updatedCount++;
      } catch (err) {
        errors.push(
          `Update failed for ${keyField}=${result.original[keyField]}: ${
            (err as Error).message
          }`
        );
      }
    }

    return APIResponseWriter({
      res,
      success: true,
      message: `Cleanup completed for page ${page} of '${table}'.`,
      statusCode: StatusCodes.OK,
      data: {
        updatedCount,
        totalProcessed: results.length,
        needsReviewCount: results.filter((r) => r.needsReview).length,
        errors,
      },
    });
  }
);

export const clearnupTableDataControllerTest = expressAsyncWrapper(
  async (req, res) => {
    const data = req.body.data;
    if (!Array.isArray(data)) {
      throw RouteError.BadRequest("Request body has to be array of objects");
    }

    const service = new DataCleanupService();
    // Clean data using AI
    let results: CleanResult[];
    try {
      results = await service.cleanDataBatch(data);
    } catch (error) {
      console.error("AI cleanup failed:", error);
      return APIResponseWriter({
        res,
        success: false,
        message: "Failed to process data cleanup. AI service may be down.",
        statusCode: StatusCodes.SERVICE_UNAVAILABLE,
      });
    }

    return APIResponseWriter({
      res,
      success: true,
      message: `Cleanup preview generated.`,
      statusCode: StatusCodes.OK,
      data: {
        count: results.length,
        needsReview: results.filter((r) => r.needsReview).length,
        suggestedUpdates: results.filter(
          (r) => !r.needsReview && Object.keys(r.changes).length > 0
        ).length,
        results,
      },
    });
  }
);
