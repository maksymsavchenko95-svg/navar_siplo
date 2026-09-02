CREATE TABLE "list_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_uk" text NOT NULL,
	"needed_amount" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"product_ref" text,
	"external_product_id" text,
	"company_id" text,
	"branch_id" text,
	"product_name" text,
	"pack_size" numeric(10, 2),
	"pack_count" integer DEFAULT 0 NOT NULL,
	"price" numeric(10, 2),
	"old_price" numeric(10, 2),
	"is_promo" boolean DEFAULT false NOT NULL,
	"confidence" numeric(3, 2),
	"decision" text,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"out_of_stock" boolean DEFAULT false NOT NULL,
	"block_reason" text,
	"user_overridden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"plan_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"recipe_id" uuid,
	"slug" text NOT NULL,
	"title_uk" text NOT NULL,
	"servings" integer NOT NULL,
	"cost_uah" numeric(10, 2) NOT NULL,
	"promo_share_uah" numeric(10, 2) NOT NULL,
	"kcal_serving" numeric(7, 2),
	"protein_serving" numeric(6, 2),
	"fat_serving" numeric(6, 2),
	"carbs_serving" numeric(6, 2),
	"pinned" boolean DEFAULT false NOT NULL,
	"outcome" text,
	CONSTRAINT "plan_items_plan_id_day_index_pk" PRIMARY KEY("plan_id","day_index")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"seed" bigint NOT NULL,
	"days" integer NOT NULL,
	"budget_uah" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_est_uah" numeric(10, 2),
	"promo_share" numeric(4, 3),
	"estimated_cost_uah" numeric(10, 2),
	"unpriced_line_count" integer DEFAULT 0 NOT NULL,
	"protein_floor_met" boolean,
	"kcal_corridor_met" boolean,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_lines" ADD CONSTRAINT "list_lines_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_lines" ADD CONSTRAINT "list_lines_ingredient_id_canonical_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."canonical_ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_lines_plan_idx" ON "list_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plans_household_created_idx" ON "plans" USING btree ("household_id","created_at" DESC NULLS LAST);