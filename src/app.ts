import express from "express";
import cors from "cors";

import expressRouteErrorHandlerMiddleware from "./middlewares/expressRouteErrorHandler";
import rateLimiter from "./middlewares/rateLimiter";

import { healthRoute } from "./routes";
import { publicApiIndexController } from "./controllers/doc.controller";

const app = express();

app.use(cors());
app.use(express.json());

// 🚦 Apply rate limiting to all incoming requests
app.use(rateLimiter);

// 📘 Public API index - shows available public endpoints
app.get("/", publicApiIndexController);

// ❤️ Health check endpoint (under versioned API namespace)
app.use("/api/v1/health", healthRoute);

// 🧯 Global error handling middleware (handles thrown errors or rejected promises)
app.use(expressRouteErrorHandlerMiddleware);

export default app;
