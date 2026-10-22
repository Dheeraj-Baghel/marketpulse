CREATE TABLE `daily_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`security_id` integer NOT NULL,
	`trade_date` text NOT NULL,
	`open` integer NOT NULL,
	`high` integer NOT NULL,
	`low` integer NOT NULL,
	`close` integer NOT NULL,
	`volume` integer,
	`source` text NOT NULL,
	`adjustment_status` text NOT NULL,
	`imported_at` text NOT NULL,
	`last_import_id` integer NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_import_id`) REFERENCES `price_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "daily_prices_positive" CHECK("daily_prices"."open" > 0 AND "daily_prices"."high" > 0 AND "daily_prices"."low" > 0 AND "daily_prices"."close" > 0),
	CONSTRAINT "daily_prices_range" CHECK("daily_prices"."high" >= "daily_prices"."low" AND "daily_prices"."open" BETWEEN "daily_prices"."low" AND "daily_prices"."high" AND "daily_prices"."close" BETWEEN "daily_prices"."low" AND "daily_prices"."high"),
	CONSTRAINT "daily_prices_volume" CHECK("daily_prices"."volume" IS NULL OR "daily_prices"."volume" >= 0),
	CONSTRAINT "daily_prices_date_shape" CHECK("daily_prices"."trade_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_prices_security_date_source_uq` ON `daily_prices` (`security_id`,`trade_date`,`source`);--> statement-breakpoint
CREATE INDEX `daily_prices_security_date_idx` ON `daily_prices` (`security_id`,`trade_date`);--> statement-breakpoint
CREATE TABLE `price_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`source_modified_at` text,
	`imported_at` text NOT NULL,
	`security_id` integer,
	`requested_symbol` text,
	`requested_series` text,
	`status` text NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`records_inserted` integer DEFAULT 0 NOT NULL,
	`records_updated` integer DEFAULT 0 NOT NULL,
	`records_skipped` integer DEFAULT 0 NOT NULL,
	`records_rejected` integer DEFAULT 0 NOT NULL,
	`source_date_from` text,
	`source_date_to` text,
	`error_message` text,
	`messages` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
