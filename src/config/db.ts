import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const convertBigIntToString = (obj: any): any => {
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }
  if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        convertBigIntToString(value),
      ])
    );
  }
  return obj;
};

prisma.$use(async (params, next) => {
  const result = await next(params);
  if (result === null || result === undefined) return result;

  return convertBigIntToString(result);
});

export default prisma;
