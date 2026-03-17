import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL or DATABASE_POOLER_URL is required");
}

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
