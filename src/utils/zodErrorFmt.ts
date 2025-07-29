import { ZodError } from "zod";

const zodErrorFmt = (error: ZodError<any>) => {
  return error.issues.map((error) => ({
    field: error.path[0],
    message: error.message,
  }));
};

export default zodErrorFmt;
