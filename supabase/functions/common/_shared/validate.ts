// supabase/functions/common/_shared/validate.ts
// Zod validation wrapper for Edge Functions

import { z, ZodError, ZodSchema } from "https://deno.land/x/zod@v3.22.4/mod.ts";

export { z };

export class ValidationError extends Error {
  public statusCode: number;
  public details: z.ZodIssue[];

  constructor(zodError: ZodError) {
    const message = zodError.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    
    super(`Validation failed: ${message}`);
    this.name = "ValidationError";
    this.statusCode = 400;
    this.details = zodError.issues;
  }
}

/**
 * Validate data against a Zod schema.
 * Throws ValidationError if validation fails.
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  
  return result.data;
}

/**
 * Parse and validate JSON body from a request.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<T> {
  let body: unknown;
  
  try {
    body = await request.json();
  } catch {
    throw new ValidationError(
      new ZodError([
        {
          code: "custom",
          path: [],
          message: "Invalid JSON body",
        },
      ])
    );
  }
  
  return validate(schema, body);
}

/**
 * Parse and validate query parameters from a request URL.
 */
export function validateQuery<T>(
  request: Request,
  schema: ZodSchema<T>
): T {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  
  return validate(schema, params);
}

// Common validation schemas
export const commonSchemas = {
  uuid: z.string().uuid(),
  email: z.string().email(),
  url: z.string().url(),
  isoDateTime: z.string().datetime(),
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};

