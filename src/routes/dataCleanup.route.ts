// routes/cleanup.routes.ts
import { Router } from "express";
import {
  cleanupTableDataController,
  cleanupTableDataControllerTest,
  // contactsAndAddressTablesCleanupController,
  dmsUsersNameCapitalizerController,
  // getPotentialDuplicatePeopleGroupsController,
  // getPotentialDuplicatePeopleGroupsTestController,
  // getDuplicatePeopleByFullNameController,
  getDuplicateEntitiesByFullNameController,
  getDuplicateEntitiesByNameWithTypeController,
} from "../controllers/dataCleanUp.controller";

import {
  getEntitiesWithGivenNameController,
  analyzeDuplicateEntitiesController,
  // getPotentialDuplicateEntitiesGroupsTestController,
} from "../controllers/entitiesMerge.controller";
import { applyEntitiesDuplicateMergeController } from "../controllers/applyEntitiesDuplicateMerge.controller";

const router = Router();
router.post("/", cleanupTableDataController);
router.post("/test", cleanupTableDataControllerTest);
router.post("/dms/capitalize-names", dmsUsersNameCapitalizerController);
// router.get("/dms/duplicates", dataDuplicationController);
// router.get(
//   "/people/duplicates/analyze",
//   getPotentialDuplicatePeopleGroupsController
// );


// router.post(
//   "/entities/duplicates/analyze/test",
//   // getPotentialDuplicateEntitiesGroupsTestController
// );

// router.post(
//   "/people/duplicates/analyze/test",
//   getPotentialDuplicatePeopleGroupsTestController
// );

// router.get("/people/similar/by-name", getDuplicatePeopleByFullNameController);

router.get(
  "/entities/similar/by-name",
  getDuplicateEntitiesByFullNameController
);

// ! Updated once
router.get(
  "/entities/similar/by-name/:type",
  getDuplicateEntitiesByNameWithTypeController
);

router.get(
  "/entities/by-name/:name",
  getEntitiesWithGivenNameController
);


router.post(
  "/entities/duplicates/analyze",
  analyzeDuplicateEntitiesController
);

router.post(
  "/entities/resolve-duplicates",
  applyEntitiesDuplicateMergeController
);


// !


export default router;
