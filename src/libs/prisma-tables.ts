import { dmsPrisma, entitiesPrisma } from "../config/db";

export async function getEntitiesPrismaTableNames(): Promise<string[]> {
  const prisma = entitiesPrisma;
  const modelNames = Object.keys(prisma).filter((key) => {
    // Exclude internal Prisma methods and properties
    return (
      !key.startsWith("$") &&
      !key.startsWith("_") &&
      typeof prisma[key as keyof typeof prisma] === "object" &&
      "findMany" in prisma[key as keyof typeof prisma]
    );
  });

  return modelNames;
}

export async function getDMSPrismaTableNames(): Promise<string[]> {
  const prisma = dmsPrisma;
  const modelNames = Object.keys(prisma).filter((key) => {
    // Exclude internal Prisma methods and properties
    return (
      !key.startsWith("$") &&
      !key.startsWith("_") &&
      typeof prisma[key as keyof typeof prisma] === "object" &&
      "findMany" in prisma[key as keyof typeof prisma]
    );
  });

  return modelNames;
}
