import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, decimal, jsonb, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// MCP Analysis Sessions
export const mcpSessions = pgTable("mcp_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  contractAddress: text("contract_address").notNull(),
  chainId: integer("chain_id").notNull(),
  blockNumber: text("block_number"),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  configuration: jsonb("configuration").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tool Executions
export const toolExecutions = pgTable("tool_executions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id").references(() => mcpSessions.id),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  input: jsonb("input"),
  output: jsonb("output"),
  errorMessage: text("error_message"),
  executionTime: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Exploit Discoveries
export const exploitDiscoveries = pgTable("exploit_discoveries", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id").references(() => mcpSessions.id),
  contractAddress: text("contract_address").notNull(),
  chainId: integer("chain_id").notNull(),
  exploitType: text("exploit_type").notNull(),
  severity: text("severity").notNull(), // low, medium, high, critical
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  valueAtRisk: decimal("value_at_risk", { precision: 20, scale: 2 }),
  proofOfConcept: text("proof_of_concept"),
  description: text("description"),
  validated: boolean("validated").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Performance Metrics
export const performanceMetrics = pgTable("performance_metrics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  metricType: text("metric_type").notNull(), // cpu, memory, network, response_time
  value: decimal("value", { precision: 10, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

// API Usage Statistics
export const apiUsage = pgTable("api_usage", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  service: text("service").notNull(), // etherscan, alchemy, etc.
  endpoint: text("endpoint").notNull(),
  requestCount: integer("request_count").default(0),
  successCount: integer("success_count").default(0),
  errorCount: integer("error_count").default(0),
  averageResponseTime: decimal("average_response_time", { precision: 10, scale: 2 }),
  date: timestamp("date").defaultNow(),
});

// Relations
export const mcpSessionsRelations = relations(mcpSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [mcpSessions.userId],
    references: [users.id],
  }),
  toolExecutions: many(toolExecutions),
  exploitDiscoveries: many(exploitDiscoveries),
}));

export const toolExecutionsRelations = relations(toolExecutions, ({ one }) => ({
  session: one(mcpSessions, {
    fields: [toolExecutions.sessionId],
    references: [mcpSessions.id],
  }),
}));

export const exploitDiscoveriesRelations = relations(exploitDiscoveries, ({ one }) => ({
  session: one(mcpSessions, {
    fields: [exploitDiscoveries.sessionId],
    references: [mcpSessions.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertMcpSessionSchema = createInsertSchema(mcpSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertToolExecutionSchema = createInsertSchema(toolExecutions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExploitDiscoverySchema = createInsertSchema(exploitDiscoveries).omit({
  id: true,
  createdAt: true,
});

export const insertPerformanceMetricSchema = createInsertSchema(performanceMetrics).omit({
  id: true,
  timestamp: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type McpSession = typeof mcpSessions.$inferSelect;
export type InsertMcpSession = z.infer<typeof insertMcpSessionSchema>;
export type ToolExecution = typeof toolExecutions.$inferSelect;
export type InsertToolExecution = z.infer<typeof insertToolExecutionSchema>;
export type ExploitDiscovery = typeof exploitDiscoveries.$inferSelect;
export type InsertExploitDiscovery = z.infer<typeof insertExploitDiscoverySchema>;
export type PerformanceMetric = typeof performanceMetrics.$inferSelect;
export type InsertPerformanceMetric = z.infer<typeof insertPerformanceMetricSchema>;
