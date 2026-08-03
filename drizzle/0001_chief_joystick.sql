CREATE INDEX `idx_customers_stage` ON `customers` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_customer_id` ON `inquiries` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_status_received` ON `inquiries` (`status`,`received_at`);