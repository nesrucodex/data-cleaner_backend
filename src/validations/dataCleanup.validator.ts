import * as z from "zod";

export const cleanupBodyValidation = z.object({
  db: z.enum(["dms", "entities"], {
    message: "Database must be 'dms' or 'entities'",
  }),
  table: z.string().min(1, { message: "Table name is required" }),
  keyField: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(10),
  previewOnly: z.boolean().optional().default(true),
});
