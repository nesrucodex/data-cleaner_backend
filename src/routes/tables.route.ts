import { Router } from "express";
import {
  getAllAllowedTablesController,
  getPaginatedDMSTableController,
  getPaginatedEntitiesTableController,
} from "../controllers/tables.controller";

const router = Router();

router.get("/", getAllAllowedTablesController);
router.get("/dms/:tableName", getPaginatedDMSTableController);
router.get("/entities/:tableName", getPaginatedEntitiesTableController);

export default router;
