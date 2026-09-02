CREATE TABLE "receipt_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"source" text NOT NULL,
	"order_external_id" text NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"raw_name" text NOT NULL,
	"agg_key" text NOT NULL,
	"product_ref" text,
	"catalog_slug" text,
	"quantity" numeric(10, 3),
	"unit" text,
	"price" numeric(10, 2),
	"ingredient_id" uuid
);
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_ingredient_id_canonical_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."canonical_ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_lines_household_purchased_idx" ON "receipt_lines" USING btree ("household_id","purchased_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "receipt_lines_ingredient_idx" ON "receipt_lines" USING btree ("ingredient_id");