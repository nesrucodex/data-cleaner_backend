import { NextFunction, Request, Response, RequestHandler } from "express";

interface WrapperOptions {
  onError?: (
    error: any,
    req: Request,
    res: Response,
    next: NextFunction
  ) => void;
}

type AsyncCallback = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

const expressAsyncWrapper = (
  callback: AsyncCallback,
  options?: WrapperOptions
): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await callback(req, res, next);
    } catch (error) {
      if (options?.onError) {
        options.onError(error, req, res, next);
      } else {
        next(error);
      }
    }
  };
};

export { expressAsyncWrapper };

export default expressAsyncWrapper;
