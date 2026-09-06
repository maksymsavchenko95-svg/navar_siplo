CREATE TABLE "mcp_call_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"correlation_id" text NOT NULL,
	"household_id" uuid,
	"plan_id" uuid,
	"phase" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"result_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_call_log_plan_idx" ON "mcp_call_log" USING btree ("plan_id","started_at");--> statement-breakpoint
CREATE INDEX "mcp_call_log_correlation_idx" ON "mcp_call_log" USING btree ("correlation_id");