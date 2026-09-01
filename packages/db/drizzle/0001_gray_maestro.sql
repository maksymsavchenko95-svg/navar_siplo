CREATE TABLE "nutrition_targets" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"protein_min_g" integer NOT NULL,
	"kcal_target" integer NOT NULL,
	"kcal_tolerance" numeric(3, 2) DEFAULT '0.15' NOT NULL,
	"direction" text NOT NULL,
	"computed_from" jsonb NOT NULL,
	CONSTRAINT "kcal_floor" CHECK ("nutrition_targets"."kcal_target" >= 1200)
);
--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "kcal_100" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "protein_100" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "fat_100" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "carbs_100" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "fiber_100" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "canonical_ingredients" ADD COLUMN "nutrition_src" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "goal" text DEFAULT 'routine' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "kcal_serving" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "protein_serving" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "fat_serving" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "carbs_serving" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;