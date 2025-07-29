import { Router } from "express";
import { getPaginatedTableController } from "../controllers/tables.controller";

const router = Router();

router.get("/:tableName", getPaginatedTableController);

export default router;
