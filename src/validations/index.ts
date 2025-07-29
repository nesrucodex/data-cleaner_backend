import * as z from "zod";

const queryValidation = z.object({
  limit: z.coerce.number().min(1).optional().default(10),
  page: z.coerce.number().min(1).optional().default(1),
});

export { queryValidation };
