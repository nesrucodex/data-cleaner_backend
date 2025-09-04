import express from "express";
import cors from "cors";

import expressRouteErrorHandlerMiddleware from "./middlewares/expressRouteErrorHandler";
import rateLimiter from "./middlewares/rateLimiter";

import { swaggerRoute, healthRoute, tablesRoute, cleanupRoute } from "./routes";
import path from "path";
import { HEALTH_CHECK_URL, NODE_ENV } from "./config/env";
import { startHealthCheckCron } from "./crons";
import morgan from "morgan";
import { logger } from "@azure/identity";
import { dmsPrisma, entitiesPrisma } from "./config/db";
import naturalQueryRoute from "./routes/natural-query.route";

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("tiny"), (req, res, next) => {
  logger.info(`${req.method} ${req.path} ${res.statusCode}`);
  next();
});

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
app.use("/api/v1/cleanup", cleanupRoute);
app.use("/api/v1/natural-query", naturalQueryRoute);

app.get("/test", async (_, res) => {
  const entities = await entitiesPrisma.entity.findMany({
    where: {},
    take: 10,
  });

  res.json({ entities });
});

app.get("/test2", async (_, res) => {
  let entities = await entitiesPrisma.entity.findMany({
    where: {
      type: 1,
      name: "Nexus Edge Trades",
    },
    include: {
      address: true,
      // entity_property_entity_property_entity_idToentity: true,
      people: true,
      entity_mapping_entity_mapping_entity_idToentity: true,
      entity_mapping_entity_mapping_parent_idToentity: true,
      // entity_property_entity_property_parent_idToentity: true,
    },
    // take: 10,
  });

  for (const entity of entities) {
    if (entity.entity_mapping_entity_mapping_parent_idToentity.length === 0) {
      continue;
    }

    const response = await entitiesPrisma.entity.findMany({
      where: {
        entity_id: {
          in: entity.entity_mapping_entity_mapping_parent_idToentity.map(
            (i) => i.entity_id
          ),
        },
      },
      include: {
        address: true,
        // entity_property_entity_property_entity_idToentity: true,
        people: true,
        entity_mapping_entity_mapping_entity_idToentity: true,
        entity_mapping_entity_mapping_parent_idToentity: true,
        // entity_property_entity_property_parent_idToentity: true,
      },
    });

    entities.push(...response);
  }

  return res.json({ entities });
});

app.get("/test3", async (_, res) => {
  const deletedEle = await entitiesPrisma.entity_mapping.delete({
    where: {
      entity_mapping_id: 243565,
    },
  });

  res.json({ deletedEle });
});

app.get("/test4", async (_, res) => {
  const deletedEle = await entitiesPrisma.entity.deleteMany({
    where: {
      entity_id: 151488,
    },
  });

  res.json({ deletedEle });
});

if (NODE_ENV !== "development" && HEALTH_CHECK_URL) {
  startHealthCheckCron(HEALTH_CHECK_URL, true);
}

// 🧯 Global error handling middleware (handles thrown errors or rejected promises)
app.use(expressRouteErrorHandlerMiddleware);

export default app;
