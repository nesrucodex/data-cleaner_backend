import express from "express";
import expressRouteErrorHandlerMiddleware from "./middlewares/expressRouteErrorHandler";
import cors from "cors";
import { healthRoute } from "./routes";
import rateLimiter from "./middlewares/rateLimiter";

const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

app.use("/api/v1/health", healthRoute);

app.use(expressRouteErrorHandlerMiddleware);

export default app;
