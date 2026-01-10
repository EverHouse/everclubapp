ALTER TABLE "tours" ADD COLUMN "hubspot_meeting_id" varchar;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_hubspot_meeting_id_unique" UNIQUE("hubspot_meeting_id");