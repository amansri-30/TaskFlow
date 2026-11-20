import { NextApiResponse } from "next";

export function handleRes(
  res: NextApiResponse,
  status: number,
  success?: boolean,
  message?: string,
  ...props: Record<string, any>[]
) {
  // `props` is a rest *array*. Spreading it directly produced
  // `{ success, message, 0: { ...payload } }`, so every consumer reading
  // `data.tasks`, `data.quote`, `data.task`, etc. received undefined. Merge the
  // supplied objects into the body instead; callers pass one payload object.
  const responseBody = {
    success: success ?? false,
    message: message ?? "Unknown error occurred",
    ...Object.assign({}, ...props)
  };

  return res.status(status).json(responseBody);
}
