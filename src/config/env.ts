import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT as string;

export { PORT };
