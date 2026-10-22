CREATE TABLE `directory_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`source_modified_at` text,
	`imported_at` text NOT NULL,
	`rows_total` integer NOT NULL,
	`rows_inserted` integer NOT NULL,
	`rows_updated` integer NOT NULL,
	`rows_unchanged` integer NOT NULL,
	`rows_rejected` integer NOT NULL,
	`rows_duplicate` integer NOT NULL,
	`rows_deactivated` integer NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`isin` text NOT NULL,
	`segment` text NOT NULL,
	`series` text NOT NULL,
	`instrument_kind` text NOT NULL,
	`issuer_code` text NOT NULL,
	`listing_date` text,
	`face_value` real,
	`paid_up_value` real,
	`market_lot` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`first_imported_at` text NOT NULL,
	`imported_at` text NOT NULL,
	`last_import_id` integer NOT NULL,
	FOREIGN KEY (`last_import_id`) REFERENCES `directory_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "securities_isin_len" CHECK(length("securities"."isin") = 12)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_segment_symbol_series_uq` ON `securities` (`segment`,`symbol`,`series`);--> statement-breakpoint
CREATE INDEX `securities_symbol_idx` ON `securities` (`symbol`);--> statement-breakpoint
CREATE INDEX `securities_isin_idx` ON `securities` (`isin`);--> statement-breakpoint
CREATE INDEX `securities_name_idx` ON `securities` (`name`);--> statement-breakpoint
CREATE INDEX `securities_issuer_idx` ON `securities` (`issuer_code`);