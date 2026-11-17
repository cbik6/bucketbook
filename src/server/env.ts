import { z } from "zod";

/**
 * Environment configuration, validated once at startup (see instrumentation.ts).
 * Every variable is documented in .env.example. Reading is lazy so that
 * `next build` works without a database or secrets.
 */

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 random bytes encoded as base64 (generate with: openssl rand -base64 32)",
  });

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .default("true")
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: "must start with postgres://" }),
  APP_URL: z.url({
    message: "must be the full URL people use to open the app, like http://192.168.1.20:3000",
  }),
  BETTER_AUTH_SECRET: z.string().min(32, {
    message: "must be at least 32 characters (generate with: openssl rand -base64 32)",
  }),
  APP_ENCRYPTION_KEY: base64Key32,
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  RECEIPTS_DIR: z.string().default("./data/receipts"),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  JOBS_ENABLED: booleanFlag,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new EnvError(
      `Configuration problem. Check your .env file (see .env.example):\n${lines.join("\n")}`,
    );
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
