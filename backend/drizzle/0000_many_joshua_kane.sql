CREATE TABLE `nova_audit` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`object_id` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nova_audit_id_unique` ON `nova_audit` (`id`);--> statement-breakpoint
CREATE INDEX `idx_nova_audit_user_time` ON `nova_audit` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nova_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_nova_operations_user_idempotency` ON `nova_operations` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `nova_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nova_records_user_kind` ON `nova_records` (`user_id`,`kind`);