import { index,integer,sqliteTable,text,uniqueIndex } from "drizzle-orm/sqlite-core";

export const novaRecords=sqliteTable("nova_records",{
  id:text("id").primaryKey(),userId:text("user_id").notNull(),kind:text("kind").notNull(),status:text("status").notNull(),data:text("data").notNull(),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull(),
},table=>[index("idx_nova_records_user_kind").on(table.userId,table.kind)]);

export const novaOperations=sqliteTable("nova_operations",{
  id:text("id").primaryKey(),userId:text("user_id").notNull(),tool:text("tool").notNull(),idempotencyKey:text("idempotency_key").notNull(),inputHash:text("input_hash").notNull(),status:text("status").notNull(),result:text("result").notNull(),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull(),
},table=>[uniqueIndex("idx_nova_operations_user_idempotency").on(table.userId,table.idempotencyKey)]);

export const novaAudit=sqliteTable("nova_audit",{
  sequence:integer("sequence").primaryKey({autoIncrement:true}),id:text("id").notNull().unique(),userId:text("user_id").notNull(),eventType:text("event_type").notNull(),objectId:text("object_id").notNull(),status:text("status").notNull(),metadata:text("metadata").notNull(),createdAt:text("created_at").notNull(),
},table=>[index("idx_nova_audit_user_time").on(table.userId,table.createdAt)]);

export const novaRateLimits=sqliteTable("nova_rate_limits",{
  key:text("key").notNull(),windowStart:integer("window_start").notNull(),count:integer("count").notNull(),
},table=>[uniqueIndex("idx_nova_rate_limits_key_window").on(table.key,table.windowStart),index("idx_nova_rate_limits_window").on(table.windowStart)]);
