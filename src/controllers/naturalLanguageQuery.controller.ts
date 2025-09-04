// controllers/naturalLanguageQuery.controller.ts

import { StatusCodes } from "http-status-codes";
import { entitiesPrisma, dmsPrisma } from "../config/db";
import APIResponseWriter from "../utils/apiResponseWriter";
import expressAsyncWrapper from "../utils/asyncHandler";
import RouteError from "../utils/routeErrors";
import logger from "../libs/logger";
import { DataSourceRouterService, RoutingDecision } from "../services/dataSourceRouter.service";
import { NaturalLanguageQueryAIService } from "../services/naturalLanguageQueryAIService.service"; // for entities
import { NaturalLanguageQueryAIServiceDMS } from "../services/naturalLanguageQueryAIService.dms.service"; // for DMS


// utils/extractDatabaseError.ts
export function extractDatabaseError(error: any): string {
    if (error?.meta?.message) return error.meta.message; // Prisma known error
    if (error?.message) return error.message.split("\n")[0]; // Clean up stack traces
    return "Unknown database error";
}


// === Types ===
interface NaturalQueryRequestBody {
    question: string;
    limit?: number;
}

// Maximum retries after execution failure
const MAX_CORRECTION_ATTEMPTS = 2;

export const naturalLanguageQueryController = expressAsyncWrapper(
    async (req, res) => {
        const { question }: NaturalQueryRequestBody = req.body;

        if (!question || typeof question !== "string" || !question.trim()) {
            throw RouteError.BadRequest("A valid 'question' string is required");
        }

        const cleanedQuestion = question.trim();
        const routingService = new DataSourceRouterService();
        const routingDecision: RoutingDecision = await routingService.routeQuestion(cleanedQuestion);

        logger.info("Routing Decision Made", {
            question: cleanedQuestion,
            routingDecision,
            userId: (req as any).user?.id || null,
        });

        if (routingDecision.target === "unknown") {
            throw RouteError.BadRequest(
                routingDecision.reason || "Cannot determine which system contains this data. Please clarify your question."
            );
        }

        // Choose correct AI service and DB client
        const aiService =
            routingDecision.target === "entities"
                ? new NaturalLanguageQueryAIService()
                : new NaturalLanguageQueryAIServiceDMS();

        const prismaClient = routingDecision.target === "entities" ? entitiesPrisma : dmsPrisma;

        let queryPlan = await aiService.generateQueryPlan(cleanedQuestion);
        let finalSql = queryPlan.sql;
        let attempts = 0;
        const errorFeedbackLog: Array<{ sql: string; error: string }> = [];

        while (attempts <= MAX_CORRECTION_ATTEMPTS) {
            try {
                // Apply limit if allowed
                let sqlToRun = finalSql;
                if (queryPlan.allowsLimit && req.body.limit) {
                    const limit = Math.min(Number(req.body.limit), 100);
                    sqlToRun = sqlToRun.replace(/\bLIMIT \?/i, `LIMIT ${limit}`);
                }

                const rawResults = await prismaClient.$queryRawUnsafe<any[]>(sqlToRun);
                const results = Array.isArray(rawResults) ? rawResults : [];

                logger.info("Query Executed Successfully", {
                    question: cleanedQuestion,
                    sql: sqlToRun,
                    resultCount: results.length,
                    attempts,
                    userId: (req as any).user?.id || null,
                });

                return APIResponseWriter({
                    res,
                    message: "Query executed successfully",
                    statusCode: StatusCodes.OK,
                    success: true,
                    data: {
                        question: cleanedQuestion,
                        explanation: queryPlan.explanation,
                        sql: sqlToRun,
                        results,
                        dataSource: routingDecision.target,
                        routingConfidence: routingDecision.confidence,
                        correctionAttempts: attempts,
                        errorFeedback: errorFeedbackLog,
                    },
                });
            } catch (error: any) {
                const dbError = extractDatabaseError(error);
                errorFeedbackLog.push({ sql: finalSql, error: dbError });

                logger.warn("SQL Execution Failed - Attempting AI Correction", {
                    attempt: attempts,
                    sql: finalSql,
                    error: dbError,
                    question: cleanedQuestion,
                });

                // Stop if max retries reached
                if (attempts === MAX_CORRECTION_ATTEMPTS) {
                    logger.error("Max correction attempts exceeded", { errorFeedbackLog });
                    break;
                }

                // Let AI correct based on real error
                const correctedPlan = await aiService.generateQueryPlan(cleanedQuestion, errorFeedbackLog);
                if (!correctedPlan.successStatus) {
                    logger.info("AI gave up after feedback", { reason: correctedPlan.explanation });
                    queryPlan = correctedPlan;
                    finalSql = correctedPlan.sql;
                    break;
                }

                queryPlan = correctedPlan;
                finalSql = correctedPlan.sql;
                attempts++;
            }
        }

        // Final fallback: return error details
        return APIResponseWriter({
            res,
            message: "Failed to execute query after multiple attempts.",
            statusCode: StatusCodes.BAD_REQUEST,
            success: false,
            data: {
                question: cleanedQuestion,
                explanation: "The query could not be executed due to persistent errors.",
                finalSql: finalSql,
                errorFeedback: errorFeedbackLog,
                dataSource: routingDecision.target,
            },
        });
    }
);