import { Server } from "http";
import logger from "../libs/logger";
import { shutdown } from "./shutdown";
import { PrismaClient } from "@prisma/client";

export function registerSignalHandlers(server: Server, prisma: PrismaClient) {
  process.on("SIGINT", () => handleSignal("SIGINT", server, prisma));
  
  process.on("SIGTERM", () => handleSignal("SIGTERM", server, prisma));

  process.on("unhandledRejection", (reason) => {
    logger.error("💥 Unhandled Promise Rejection:", reason);
    shutdown(server, prisma, 1);
  });

  process.on("uncaughtException", (err) => {
    logger.error("💥 Uncaught Exception:", err);
    shutdown(server, prisma, 1);
  });
}

function handleSignal(signal: string, server: Server, prisma: PrismaClient) {
  logger.info(`🛑 Received ${signal} — shutting down...`);
  shutdown(server, prisma, 0);
}
