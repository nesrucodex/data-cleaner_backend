// controllers/duplicateController.ts

import { StatusCodes } from "http-status-codes";
import { entitiesPrisma } from "../config/db";
import APIResponseWriter from "../utils/apiResponseWriter";
import expressAsyncWrapper from "../utils/asyncHandler";
import { writeFile } from "fs/promises";
import {
  EntityMergeAIService,
  EntityMergeOutput,
  EntityRecord,
} from "../services/entityMergeAI.service";
import RouteError from "../utils/routeErrors";
import { AIAddressDeduplicatorService } from "../services/aiAddressDeduplicator.service";
import { AIPropertyMergerService } from "../services/aiPropertyMerger.service";
import { entity, entity_property } from "../../generated/client/entities_prod";

// === Types ===
type MergedPerson = NonNullable<EntityRecord["people"][0]>;
type MergedAddress = NonNullable<EntityRecord["address"][0]>;
type MergedProperty = NonNullable<
  EntityRecord["entity_property_entity_property_entity_idToentity"][0]
>;

export const _getPotentialDuplicateEntitiesGroupsController =
  expressAsyncWrapper(async (req, res) => {
    const name = req.params["name"] as string

    if (!name) {
      throw RouteError.BadRequest("Query parameter 'name' is required");
    }

    // Fetch all entities with this name
    const entities = await entitiesPrisma.entity.findMany({
      where: {
        type: 2,
        name: { equals: name },
        // dups_ok: {
        //   not: -1,
        // },
        is_deleted: false,
      },
      include: {
        people: true,
        address: true,
        entity_property_entity_property_entity_idToentity: true,
      },
    });

    if (entities.length === 0) {
      return APIResponseWriter({
        res,
        message: "No entities found matching the given name",
        statusCode: StatusCodes.OK,
        success: true,
        data: {
          grouped: [],
          totalFound: 0,
          duplicateGroupsCount: 0,
        },
      });
    }

    // Save for debugging
    await writeFile(
      `demo/${encodeURIComponent(name)}.json`,
      JSON.stringify(entities, null, 2)
    );

    if (2 > 1) {
      return APIResponseWriter({
        res,
        message: "Entities found matching the given name",
        statusCode: StatusCodes.OK,
        success: true,
        data: entities,
      });
    }

    const aiService = new EntityMergeAIService();
    const seenEntityIds = new Set<number>();
    const grouped: Array<{
      aiDecision: EntityMergeOutput;
      mergedEntity: EntityRecord;
      deletionPlan: {
        retained_entity_id: number;
        deleted_entity_ids: number[];
        tables_to_cleanup: Record<string, number[]>;
      };
    }> = [];

    // Group by name (can be extended later for fuzzy match)
    const groups = [entities];

    for (const group of groups) {
      if (group.length < 2) continue;

      // Sort by entity_id ascending (older = better fallback)
      const sortedGroup = group.sort((a, b) => a.entity_id - b.entity_id);
      const primary = sortedGroup[0];
      const duplicates = sortedGroup
        .slice(1)
        .filter((dup) => !seenEntityIds.has(dup.entity_id));

      if (duplicates.length === 0) continue;

      try {
        // === AI DECISION: Which to keep/remove? ===
        const aiInput: { primary: EntityRecord; duplicates: EntityRecord[] } = {
          primary,
          duplicates,
        };
        const aiDecision = await aiService.call(aiInput);

        const keepEntityId = parseInt(aiDecision.keep, 10);
        const removeEntityIds = aiDecision.remove.map((id) => parseInt(id, 10));

        // Map for quick lookup
        const entityMap = new Map<number, EntityRecord>();
        group.forEach((e) => entityMap.set(e.entity_id, e));

        const keptEntity = entityMap.get(keepEntityId);
        if (!keptEntity) {
          console.warn(
            `AI decided to keep entity ID ${keepEntityId}, but it's not in the group.`
          );
          continue;
        }

        const removedEntities = removeEntityIds
          .map((id) => entityMap.get(id))
          .filter((e): e is EntityRecord => e !== undefined);

        // Mark all as processed
        [...removedEntities, keptEntity].forEach((e) =>
          seenEntityIds.add(e.entity_id)
        );

        // === MERGE LOGIC: Build one complete, clean entity ===

        // 1. Merge all people into one complete person
        const allPeople = [keptEntity, ...removedEntities].flatMap(
          (e) => e.people
        );

        const mergedPerson = mergePeopleIntoOne(allPeople);

        // 2. Deduplicate and merge addresses
        const allAddresses = [
          ...keptEntity.address,
          ...removedEntities.flatMap((e) => e.address),
        ];
        // Use AI to deduplicate
        const aiAddressDeduplicator = new AIAddressDeduplicatorService();
        const mergedAddresses = await aiAddressDeduplicator.deduplicate(
          allAddresses
        );

        console.log({ mergedAddresses });

        // 3. Deduplicate and standardize properties (phone, email, etc.)
        const allProperties = [
          ...keptEntity.entity_property_entity_property_entity_idToentity,
          ...removedEntities.flatMap(
            (e) => e.entity_property_entity_property_entity_idToentity
          ),
        ];

        const propertyMerger = new AIPropertyMergerService();
        const mergedProperties =
          await propertyMerger.merge(allProperties);

        // 4. Fill top-level entity fields from duplicates if missing
        const mergedEntity: EntityRecord = {
          ...keptEntity,
          people: [mergedPerson], // Only one person
          address: mergedAddresses,
          entity_property_entity_property_entity_idToentity: mergedProperties,
          trade_name:
            keptEntity.trade_name ||
            (findFirst(duplicates, "trade_name") as string),
          computed_phones:
            keptEntity.computed_phones ||
            (findFirst(duplicates, "computed_phones") as string),
          computed_emails:
            keptEntity.computed_emails ||
            (findFirst(duplicates, "computed_emails") as string),
          computed_addresses:
            keptEntity.computed_addresses ||
            (findFirst(duplicates, "computed_addresses") as string),
          creator_ledger_id:
            keptEntity.creator_ledger_id ||
            (findFirst(duplicates, "creator_ledger_id") as number),
        };

        // === DELETION PLAN ===
        const deleted_entity_ids = removedEntities.map((e) => e.entity_id);
        const deleted_people_ids = removedEntities.flatMap((e) =>
          e.people.map((p) => p.people_id)
        );
        const deleted_property_ids = removedEntities.flatMap((e) =>
          e.entity_property_entity_property_entity_idToentity.map(
            (p) => p.entity_property_id
          )
        );
        const deleted_address_ids = removedEntities.flatMap((e) =>
          e.address.map((a) => a.address_id)
        );

        const tables_to_cleanup: Record<string, number[]> = {
          people: deleted_people_ids,
          entity: deleted_entity_ids,
          entity_property: deleted_property_ids,
          address: deleted_address_ids,
        };

        // Remove empty arrays
        Object.keys(tables_to_cleanup).forEach((key) => {
          if (tables_to_cleanup[key].length === 0) {
            delete tables_to_cleanup[key];
          }
        });

        // Add to result
        grouped.push({
          aiDecision,
          mergedEntity,
          deletionPlan: {
            retained_entity_id: keptEntity.entity_id,
            deleted_entity_ids,
            tables_to_cleanup,
          },
        });
      } catch (error) {
        console.error("Error processing duplicate group:", error);
        // Continue with next group
      }
    }

    return APIResponseWriter({
      res,
      message: "Potential duplicate groups analyzed successfully",
      statusCode: StatusCodes.OK,
      success: true,
      data: {
        grouped,
        totalFound: entities.length,
        duplicateGroupsCount: grouped.length,
      },
    });
  });

export const getEntitiesWithGivenNameController =
  expressAsyncWrapper(async (req, res) => {
    const name = req.params["name"] as string
    const type = req.query["type"] as string

    const parsedType = +type

    if (!name) {
      throw RouteError.BadRequest("Query parameter 'name' is required");
    }

    // Fetch all entities with this name
    const entities = await entitiesPrisma.entity.findMany({
      where: {
        type: parsedType,
        name: { equals: name },
        // dups_ok: {
        //   not: -1,
        // },
        is_deleted: false,
        deleted_at: {
          equals: null
        }
      },
      include: {
        people: true,
        address: true,
        entity_property_entity_property_entity_idToentity: true,
        entity_mapping_entity_mapping_entity_idToentity: true,
        entity_mapping_entity_mapping_parent_idToentity: true
      },
    });

    const parentEntityIds: number[] = []
    const justEntityIds: number[] = []

    for (const entity of entities) {
      for (const mapping of entity.entity_mapping_entity_mapping_parent_idToentity) {
        parentEntityIds.push(mapping.parent_id)
        justEntityIds.push(mapping.entity_id)
      }
    }

    const parents = await entitiesPrisma.entity.findMany({
      where: {
        entity_id: {
          in: parentEntityIds
        }
      }
    })

    const justEntities = await entitiesPrisma.entity.findMany({
      where: {
        entity_id: {
          in: justEntityIds
        }
      }
    })

    return APIResponseWriter({
      res,
      message: "Entities found matching the given name",
      statusCode: StatusCodes.OK,
      success: true,
      data: { entities, parents, justEntities },
    });

  });

export const analyzeDuplicateEntitiesController =
  expressAsyncWrapper(async (req, res) => {
    // Fetch all entities with this name
    const entities = req.body as EntityRecord[];

    if (entities.length === 0) {
      return APIResponseWriter({
        res,
        message: "No entities found matching the given name",
        statusCode: StatusCodes.OK,
        success: true,
        data: {
          grouped: [],
          totalFound: 0,
          duplicateGroupsCount: 0,
        },
      });
    }

    const aiService = new EntityMergeAIService();
    const seenEntityIds = new Set<number>();
    const grouped: Array<{
      aiDecision: any;
      mergedEntity: EntityRecord;
      deletionPlan: {
        retained_entity_id: number;
        deleted_entity_ids: number[];
        tables_to_cleanup: Record<string, number[]>;
      };
    }> = [];

    // Group by name (can be extended later for fuzzy match)
    const groups = [entities];

    for (const group of groups) {
      if (group.length < 2) continue;

      // Sort by entity_id ascending (older = better fallback)
      const sortedGroup = group.sort((a, b) => a.entity_id - b.entity_id);
      const primary = sortedGroup[0];
      const duplicates = sortedGroup
        .slice(1)
        .filter((dup) => !seenEntityIds.has(dup.entity_id));

      if (duplicates.length === 0) continue;

      try {
        // === AI DECISION: Which to keep/remove? ===
        const aiInput: { primary: EntityRecord; duplicates: EntityRecord[] } = {
          primary,
          duplicates,
        };
        const aiDecision = await aiService.call(aiInput);

        const keepEntityId = parseInt(aiDecision.keep, 10);
        const removeEntityIds = aiDecision.remove.map((id) => parseInt(id, 10));

        // Map for quick lookup
        const entityMap = new Map<number, EntityRecord>();
        group.forEach((e) => entityMap.set(e.entity_id, e));

        const keptEntity = entityMap.get(keepEntityId);
        if (!keptEntity) {
          console.warn(
            `AI decided to keep entity ID ${keepEntityId}, but it's not in the group.`
          );
          continue;
        }

        const removedEntities = removeEntityIds
          .map((id) => entityMap.get(id))
          .filter((e): e is EntityRecord => e !== undefined);

        // Mark all as processed
        [...removedEntities, keptEntity].forEach((e) =>
          seenEntityIds.add(e.entity_id)
        );

        // === MERGE LOGIC: Build one complete, clean entity ===

        // 1. Merge all people into one complete person
        const allPeople = [keptEntity, ...removedEntities].flatMap(
          (e) => e.people
        );

        let mergedPersons: MergedPerson[] = [];

        if (allPeople.length > 0) {
          mergedPersons.push(mergePeopleIntoOne(allPeople));
        }

        // const mergedPerson =
        //   (mergedPersons.length > 0 && mergedPersons[0]) || {};

        // 2. Deduplicate and merge addresses
        const allAddresses = [
          ...keptEntity.address,
          ...removedEntities.flatMap((e) => e.address),
        ];

        // Use AI to deduplicate
        const aiAddressDeduplicator = new AIAddressDeduplicatorService();
        const mergedAddresses = await aiAddressDeduplicator.deduplicate(
          allAddresses
        );

        const resolvedProperties = await resolveConflictingEntityProperties(keptEntity, removedEntities)

        // 4. Fill top-level entity fields from duplicates if missing
        const mergedEntity: EntityRecord = {
          ...keptEntity,
          people: mergedPersons, // Only one person
          address: mergedAddresses,
          entity_property_entity_property_entity_idToentity: resolvedProperties,
          trade_name:
            keptEntity.trade_name ||
            (findFirst(duplicates, "trade_name") as string),
          computed_phones:
            keptEntity.computed_phones ||
            (findFirst(duplicates, "computed_phones") as string),
          computed_emails:
            keptEntity.computed_emails ||
            (findFirst(duplicates, "computed_emails") as string),
          computed_addresses:
            keptEntity.computed_addresses ||
            (findFirst(duplicates, "computed_addresses") as string),
          creator_ledger_id:
            keptEntity.creator_ledger_id ||
            (findFirst(duplicates, "creator_ledger_id") as number),
        };

        // === DELETION PLAN ===
        const deleted_entity_ids = removedEntities.map((e) => e.entity_id);
        const deleted_people_ids = removedEntities.flatMap((e) =>
          e.people.map((p) => p.people_id)
        );
        const deleted_property_ids = removedEntities.flatMap((e) =>
          e.entity_property_entity_property_entity_idToentity.map(
            (p) => p.entity_property_id
          )
        );
        const deleted_address_ids = removedEntities.flatMap((e) =>
          e.address.map((a) => a.address_id)
        );

        const tables_to_cleanup: Record<string, number[]> = {
          people: deleted_people_ids,
          entity: deleted_entity_ids,
          entity_property: deleted_property_ids,
          address: deleted_address_ids,
        };

        // Remove empty arrays
        Object.keys(tables_to_cleanup).forEach((key) => {
          if (tables_to_cleanup[key].length === 0) {
            delete tables_to_cleanup[key];
          }
        });

        // Add to result
        grouped.push({
          aiDecision,
          mergedEntity,
          deletionPlan: {
            retained_entity_id: keptEntity.entity_id,
            deleted_entity_ids,
            tables_to_cleanup,
          },
        });
      } catch (error) {
        console.error("Error processing duplicate group:", error);
        // Continue with next group
      }
    }

    return APIResponseWriter({
      res,
      message: "Potential duplicate groups analyzed successfully",
      statusCode: StatusCodes.OK,
      success: true,
      data: {
        grouped,
        totalFound: entities.length,
        duplicateGroupsCount: grouped.length,
      },
    });
  });


/**
 * Normalize phone number by removing all non-digit characters
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Split full name into first and last name
 */
function splitFullName(fullName: string) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

/**
 * Merge multiple people into one complete person
 */
function mergePeopleIntoOne(peopleList: MergedPerson[]): MergedPerson {
  if (peopleList.length === 0) throw new Error("No people to merge");

  // Sort by completeness
  const sorted = peopleList.sort((a, b) => {
    const hasLastNameA = !!(a.last_name && a.last_name.trim());
    const hasLastNameB = !!(b.last_name && b.last_name.trim());
    const hasTitleA = !!(a.title && a.title.trim());
    const hasTitleB = !!(b.title && b.title.trim());
    if (hasLastNameA !== hasLastNameB) return hasLastNameA ? 1 : -1;
    if (hasTitleA !== hasTitleB) return hasTitleA ? 1 : -1;
    return a.people_id - b.people_id; // older ID first
  });

  const winner = sorted[sorted.length - 1]; // most complete
  const others = sorted.slice(0, -1);

  let firstName = winner.first_name || "";
  let lastName = winner.last_name || "";

  // If winner has full name in first_name, try to split
  if (!lastName && firstName.includes(" ")) {
    const split = splitFullName(firstName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  // Fill missing from others
  for (const p of others) {
    if (!lastName && p.last_name) lastName = p.last_name;
    if (!firstName && p.first_name) firstName = p.first_name;
    if (!winner.title && p.title) winner.title = p.title;
    if (!winner.date_of_birth && p.date_of_birth)
      winner.date_of_birth = p.date_of_birth;
  }

  // Final fallback: split if still full name
  if (!lastName && firstName.includes(" ")) {
    const split = splitFullName(firstName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  return {
    ...winner,
    first_name: firstName,
    last_name: lastName,
  };
}

/**
 * Deduplicate and standardize properties (especially phone numbers)
 */
function deduplicateAndStandardizeProperties(
  properties: MergedProperty[]
): MergedProperty[] {
  const map = new Map<string, MergedProperty>(); // key: property_id + normalized_value
  const phoneMap = new Map<string, MergedProperty>(); // normalized digits → prop

  for (const prop of properties) {
    if (!prop.property_value) continue;

    if (prop.property_id === "phone_number") {
      const digits = normalizePhone(prop.property_value);
      // if (digits.length < 10) continue;

      if (!phoneMap.has(digits)) {
        // Standardize format: +27 XXX XXX-XXXX
        const formatted = digits.startsWith("27")
          ? `+27 ${digits.slice(2, 5)} ${digits.slice(5, 8)}-${digits.slice(8)}`
          : `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(
            5,
            8
          )}-${digits.slice(8)}`;

        phoneMap.set(digits, {
          ...prop,
          property_value: formatted,
        });
      }
    } else {
      const key = `${prop.property_id}_${prop.property_value
        .trim()
        .toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { ...prop });
      } else {
        const existing = map.get(key)!;
        if (prop.is_primary === "Yes") {
          existing.is_primary = "Yes";
        }
      }
    }
  }

  // Add standardized phones
  phoneMap.forEach((prop) => {
    if (!prop.property_value) {
      return;
    }
    const key = `phone_number_${prop.property_value.toLowerCase()}`;
    map.set(key, prop);
  });

  return Array.from(map.values());
}

/**
 * Find first non-null value from duplicates
 */
function findFirst(entities: EntityRecord[], field: keyof EntityRecord) {
  for (const e of entities) {
    if (e[field] != null) return e[field];
  }
  return null;
}

/**
 * Resolves conflicting entity properties by merging duplicates
 * and standardizing values (email, phone, etc.) using AI.
 * Ensures ALL properties are processed — even non-duplicated ones.
 */

type EntityWithProperty = entity & {
  entity_property_entity_property_entity_idToentity: entity_property[]
}
async function resolveConflictingEntityProperties(
  keptEntity: EntityWithProperty,
  removedEntities: EntityWithProperty[]
): Promise<entity_property[]> {
  // Step 1: Collect all properties from kept and removed entities
  const allProperties: entity_property[] = [
    ...keptEntity.entity_property_entity_property_entity_idToentity,
    ...removedEntities.flatMap(
      (entity) => entity.entity_property_entity_property_entity_idToentity
    ),
  ];

  console.log('All properties collected:', { count: allProperties.length, allProperties });

  // Step 2: Group properties by property_id only (not including title)
  // This ensures all same-type properties (e.g., all emails) are analyzed together
  const propertiesByType = new Map<string, entity_property[]>();

  for (const prop of allProperties) {
    const key = prop.property_id; // Group only by property_id
    if (!propertiesByType.has(key)) {
      propertiesByType.set(key, []);
    }
    propertiesByType.get(key)!.push(prop);
  }

  // Step 3: Send ALL grouped properties to AI for deduplication and standardization
  const allGroupedProperties = Array.from(propertiesByType.values()).flat();

  console.log('All properties (grouped by ID) sent to AI:', { allGroupedProperties });

  const propertyMerger = new AIPropertyMergerService();
  const mergedProperties: entity_property[] = await propertyMerger.merge(allGroupedProperties);

  console.log('AI-merged and standardized properties:', { mergedProperties });

  // Step 4: Deduplicate final list by (id + value) to avoid duplicates
  // Use a Set to track unique combinations
  const resolvedProperties: entity_property[] = [];
  const seen = new Set<string>();

  for (const prop of mergedProperties) {
    const valueKey = `${prop.property_id}~${prop.property_value}`;
    if (!seen.has(valueKey)) {
      seen.add(valueKey);
      resolvedProperties.push(prop);
    }
  }

  console.log('Final resolved properties after deduplication:', { resolvedProperties });

  return resolvedProperties;
}
