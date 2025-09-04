import { Router } from "express";
import { naturalLanguageQueryController } from "../controllers/naturalLanguageQuery.controller";

const router = Router()

router.post("/", naturalLanguageQueryController)

export default router