import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  timestamp,
  varchar,
  integer,
} from "drizzle-orm/pg-core";
import { users } from "./auth-session";

// Day pass purchases table - for tracking day pass sales
export const dayPassPurchases = pgTable(
  "day_pass_purchases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id"),
    productType: varchar("product_type").notNull(), // 'day-pass-coworking', 'day-pass-golf-sim'
    amountCents: integer("amount_cents").notNull(),
    quantity: integer("quantity").default(1),
    remainingUses: integer("remaining_uses").default(1), // Tracks how many uses left
    status: varchar("status").default("active"), // 'active', 'exhausted', 'expired'
    stripePaymentIntentId: varchar("stripe_payment_intent_id").notNull(),
    stripeCustomerId: varchar("stripe_customer_id").notNull(),
    hubspotDealId: varchar("hubspot_deal_id"),
    purchaserEmail: varchar("purchaser_email").notNull(),
    purchaserFirstName: varchar("purchaser_first_name"),
    purchaserLastName: varchar("purchaser_last_name"),
    purchaserPhone: varchar("purchaser_phone"),
    source: varchar("source").default("stripe"), // 'stripe', 'mindbody_import', 'manual'
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // Optional expiration
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_day_pass_purchases_user_id").on(table.userId),
    index("idx_day_pass_purchases_stripe_payment_intent_id").on(
      table.stripePaymentIntentId
    ),
    index("idx_day_pass_purchases_purchaser_email").on(table.purchaserEmail),
    index("idx_day_pass_purchases_purchased_at").on(table.purchasedAt),
    index("idx_day_pass_purchases_status").on(table.status),
  ]
);

export type DayPassPurchase = typeof dayPassPurchases.$inferSelect;
export type InsertDayPassPurchase = typeof dayPassPurchases.$inferInsert;

// Pass redemption logs - tracks when staff redeem passes
export const passRedemptionLogs = pgTable(
  "pass_redemption_logs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    purchaseId: varchar("purchase_id").notNull(), // References day_pass_purchases.id
    redeemedBy: varchar("redeemed_by").notNull(), // Staff email
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).defaultNow(),
    location: varchar("location").default("front_desk"),
    notes: varchar("notes"),
  },
  (table) => [
    index("idx_pass_redemption_logs_purchase_id").on(table.purchaseId),
    index("idx_pass_redemption_logs_redeemed_at").on(table.redeemedAt),
  ]
);

export type PassRedemptionLog = typeof passRedemptionLogs.$inferSelect;
export type InsertPassRedemptionLog = typeof passRedemptionLogs.$inferInsert;
