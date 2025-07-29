import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT as string;
const NODE_ENV = process.env.NODE_ENV as string;
const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL as string;

// ✅ MySQL Database (Prisma or mysql2)
const DATABASE_URL = process.env.DATABASE_URL as string;
const MYSQL_HOST = process.env.MYSQL_HOST as string;
const MYSQL_PORT = process.env.MYSQL_PORT as string;
const MYSQL_USER = process.env.MYSQL_USER as string;
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD as string;
const MYSQL_DB = process.env.MYSQL_DB as string;

// ✅ Azure OpenAI
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY as string;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT as string;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT as string;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION as string;
const AI_FOUNDRY_ENDPOINT = process.env.AI_FOUNDRY_ENDPOINT as string;

// ✅ phpMyAdmin
const PHPMYADMIN_URL = process.env.PHPMYADMIN_URL as string;

export {
  PORT,
  NODE_ENV,
  HEALTH_CHECK_URL,
  DATABASE_URL,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DB,
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
  AI_FOUNDRY_ENDPOINT,
  PHPMYADMIN_URL,
};
