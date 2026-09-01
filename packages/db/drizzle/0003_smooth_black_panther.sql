CREATE TABLE "consumption_models" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"median_weekly_cheque_uah" numeric(10, 2),
	"model" jsonb NOT NULL,
	"inferred_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"infer_summary" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_preferences" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"disliked_ingredients" text[] DEFAULT '{}' NOT NULL,
	"max_prep_minutes" integer,
	"cooking_weekdays" integer[] DEFAULT '{}' NOT NULL,
	"difficulty_cap" integer,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_restrictions" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "bootstrap_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "bootstrap_error" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "bootstrapped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consumption_models" ADD CONSTRAINT "consumption_models_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;