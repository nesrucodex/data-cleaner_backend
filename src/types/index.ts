export type APIResponse<T> = {
  success: boolean;
  message: string;
  data?: T;
  error?: Error;
};


export type FindManyModel = {
  findMany: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  count: () => Promise<number>;
};
