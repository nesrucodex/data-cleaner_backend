import prisma from "../config/db";

export async function getPrismaTableNames(): Promise<string[]> {
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
