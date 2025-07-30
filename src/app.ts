import express from "express";
import cors from "cors";

import expressRouteErrorHandlerMiddleware from "./middlewares/expressRouteErrorHandler";
import rateLimiter from "./middlewares/rateLimiter";

import { swaggerRoute, healthRoute, tablesRoute } from "./routes";
import path from "path";
import { HEALTH_CHECK_URL, NODE_ENV } from "./config/env";
import { startHealthCheckCron } from "./crons";
import { entitiesPrisma } from "./config/db";
import { getEntitiesPrismaTableNames } from "./libs/prisma-tables";

const app = express();

app.use(cors());
app.use(express.json());

// 🚦 Apply rate limiting to all incoming requests
app.use(rateLimiter);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Serve index.html on root "/"
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ✅ Swagger docs (at /docs)
app.use("/docs", swaggerRoute);

// ❤️ Health check endpoint (under versioned API namespace)
app.use("/api/v1/health", healthRoute);
app.use("/api/v1/tables", tablesRoute);

if (NODE_ENV !== "development" && HEALTH_CHECK_URL) {
  startHealthCheckCron(HEALTH_CHECK_URL, true);
}

// 🧯 Global error handling middleware (handles thrown errors or rejected promises)
app.use(expressRouteErrorHandlerMiddleware);

export default app;
