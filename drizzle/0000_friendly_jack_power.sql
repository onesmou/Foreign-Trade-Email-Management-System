CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`customer_type` text DEFAULT 'Unknown' NOT NULL,
	`stage` text DEFAULT 'New lead' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'Manual import' NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`ai_summary` text DEFAULT '' NOT NULL,
	`ai_intent` text DEFAULT '' NOT NULL,
	`ai_risk` text DEFAULT '' NOT NULL,
	`recommended_product` text DEFAULT '' NOT NULL,
	`lead_score` integer DEFAULT 0 NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`reply_subject` text DEFAULT '' NOT NULL,
	`draft_reply` text DEFAULT '' NOT NULL,
	`analysis_mode` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
