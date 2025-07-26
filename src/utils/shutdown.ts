import { Server } from "http";
import logger from "../libs/logger";
import { PrismaClient } from "@prisma/client";

export async function shutdown(
  server: Server,
  prisma: PrismaClient,
  exitCode: number = 0
) {
  try {
    server.close(() => {
      logger.info("✅ HTTP server closed");
    });

    await prisma.$disconnect();
    logger.info("🗃️ Prisma disconnected");

    process.exit(exitCode);
  } catch (err) {
    logger.error("❌ Error during shutdown", err);
    process.exit(1);
  }
}
