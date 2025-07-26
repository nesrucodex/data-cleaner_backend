import express from "express";
import cors from "cors";

import expressRouteErrorHandlerMiddleware from "./middlewares/expressRouteErrorHandler";
import rateLimiter from "./middlewares/rateLimiter";

import { swaggerRoute, healthRoute } from "./routes";
import path from "path";

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

// 🧯 Global error handling middleware (handles thrown errors or rejected promises)
app.use(expressRouteErrorHandlerMiddleware);

export default app;
