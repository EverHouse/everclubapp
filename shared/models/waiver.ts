import { sql } from "drizzle-orm";
import { index, uniqueIndex, pgTable, timestamp, varchar, serial, text } from "drizzle-orm/pg-core";

export const waiverDocuments = pgTable("waiver_documents", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 20 }).notNull(),
  documentHash: varchar("document_hash", { length: 64 }).notNull(),
  documentContent: text("document_content").notNull(),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("waiver_documents_version_idx").on(table.version),
  uniqueIndex("waiver_documents_version_hash_unique_idx").on(table.version, table.documentHash),
]);

export const waiverSignatures = pgTable("waiver_signatures", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  waiverVersion: varchar("waiver_version", { length: 20 }).notNull(),
  documentHash: varchar("document_hash", { length: 64 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  source: varchar("source", { length: 20 }).default("signing").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("waiver_signatures_user_id_idx").on(table.userId),
  index("waiver_signatures_signed_at_idx").on(table.signedAt),
  index("waiver_signatures_version_idx").on(table.waiverVersion),
]);

export type WaiverDocument = typeof waiverDocuments.$inferSelect;
export type InsertWaiverDocument = typeof waiverDocuments.$inferInsert;
export type WaiverSignature = typeof waiverSignatures.$inferSelect;
export type InsertWaiverSignature = typeof waiverSignatures.$inferInsert;
