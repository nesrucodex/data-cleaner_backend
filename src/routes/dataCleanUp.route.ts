// routes/cleanup.routes.ts
import { Router } from "express";
import { cleanupTableDataController, clearnupTableDataControllerTest } from "../controllers/dataCleanUp.controller";


const router = Router();
router.post("/", cleanupTableDataController);
router.post("/test", clearnupTableDataControllerTest);

export default router;
