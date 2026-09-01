CREATE TABLE "canonical_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_uk" text NOT NULL,
	"category" text NOT NULL,
	"base_unit" text NOT NULL,
	"density_g_ml" numeric(6, 3),
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"synonyms" text[] DEFAULT '{}' NOT NULL,
	"perishable_days" integer,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"age_years" integer,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "household_restrictions" (
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"severity" text DEFAULT 'strict' NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "household_restrictions_household_id_kind_code_pk" PRIMARY KEY("household_id","kind","code")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"silpo_user_ref" text,
	"weekly_budget" numeric(10, 2),
	"branch_id" text,
	"delivery_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_silpo_user_ref_unique" UNIQUE("silpo_user_ref")
);
--> statement-breakpoint
CREATE TABLE "mcp_credentials" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"payload" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	CONSTRAINT "recipe_ingredients_recipe_id_ingredient_id_pk" PRIMARY KEY("recipe_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_uk" text NOT NULL,
	"servings" integer NOT NULL,
	"active_minutes" integer NOT NULL,
	"total_minutes" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_restrictions" ADD CONSTRAINT "household_restrictions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_credentials" ADD CONSTRAINT "mcp_credentials_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_canonical_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."canonical_ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_ingredients_slug_key" ON "canonical_ingredients" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "canonical_ingredients_name_uk_trgm" ON "canonical_ingredients" USING gin ("name_uk" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "canonical_ingredients_embedding_hnsw" ON "canonical_ingredients" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_slug_key" ON "recipes" USING btree ("slug");