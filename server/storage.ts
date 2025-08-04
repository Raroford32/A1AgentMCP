import { 
  users, 
  mcpSessions,
  toolExecutions,
  exploitDiscoveries,
  performanceMetrics,
  apiUsage,
  type User, 
  type InsertUser,
  type McpSession,
  type InsertMcpSession,
  type ToolExecution,
  type InsertToolExecution,
  type ExploitDiscovery,
  type InsertExploitDiscovery,
  type PerformanceMetric,
  type InsertPerformanceMetric
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte } from "drizzle-orm";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // MCP Session management
  getMcpSessions(): Promise<McpSession[]>;
  getMcpSession(id: string): Promise<McpSession | undefined>;
  createMcpSession(session: InsertMcpSession): Promise<McpSession>;
  updateMcpSession(id: string, updates: Partial<McpSession>): Promise<McpSession | undefined>;

  // Tool execution management
  getToolExecutions(sessionId?: string): Promise<ToolExecution[]>;
  createToolExecution(execution: InsertToolExecution): Promise<ToolExecution>;
  updateToolExecution(id: string, updates: Partial<ToolExecution>): Promise<ToolExecution | undefined>;

  // Exploit discovery management
  getExploitDiscoveries(): Promise<ExploitDiscovery[]>;
  createExploitDiscovery(exploit: InsertExploitDiscovery): Promise<ExploitDiscovery>;

  // Performance metrics
  getPerformanceMetrics(hours?: number): Promise<PerformanceMetric[]>;
  createPerformanceMetric(metric: InsertPerformanceMetric): Promise<PerformanceMetric>;

  // API usage statistics
  getApiUsage(days?: number): Promise<any[]>;
  recordApiUsage(service: string, endpoint: string, success: boolean, responseTime: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // MCP Session methods
  async getMcpSessions(): Promise<McpSession[]> {
    return await db
      .select()
      .from(mcpSessions)
      .orderBy(desc(mcpSessions.createdAt))
      .limit(100);
  }

  async getMcpSession(id: string): Promise<McpSession | undefined> {
    const [session] = await db
      .select()
      .from(mcpSessions)
      .where(eq(mcpSessions.id, id));
    return session || undefined;
  }

  async createMcpSession(sessionData: InsertMcpSession): Promise<McpSession> {
    const [session] = await db
      .insert(mcpSessions)
      .values(sessionData)
      .returning();
    return session;
  }

  async updateMcpSession(id: string, updates: Partial<McpSession>): Promise<McpSession | undefined> {
    const [session] = await db
      .update(mcpSessions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mcpSessions.id, id))
      .returning();
    return session || undefined;
  }

  // Tool execution methods
  async getToolExecutions(sessionId?: string): Promise<ToolExecution[]> {
    let query = db.select().from(toolExecutions);
    
    if (sessionId) {
      query = query.where(eq(toolExecutions.sessionId, sessionId));
    }
    
    return await query
      .orderBy(desc(toolExecutions.createdAt))
      .limit(200);
  }

  async createToolExecution(execution: InsertToolExecution): Promise<ToolExecution> {
    const [toolExecution] = await db
      .insert(toolExecutions)
      .values(execution)
      .returning();
    return toolExecution;
  }

  async updateToolExecution(id: string, updates: Partial<ToolExecution>): Promise<ToolExecution | undefined> {
    const [execution] = await db
      .update(toolExecutions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(toolExecutions.id, id))
      .returning();
    return execution || undefined;
  }

  // Exploit discovery methods
  async getExploitDiscoveries(): Promise<ExploitDiscovery[]> {
    return await db
      .select()
      .from(exploitDiscoveries)
      .orderBy(desc(exploitDiscoveries.createdAt))
      .limit(100);
  }

  async createExploitDiscovery(exploit: InsertExploitDiscovery): Promise<ExploitDiscovery> {
    const [discovery] = await db
      .insert(exploitDiscoveries)
      .values(exploit)
      .returning();
    return discovery;
  }

  // Performance metrics methods
  async getPerformanceMetrics(hours: number = 24): Promise<PerformanceMetric[]> {
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return await db
      .select()
      .from(performanceMetrics)
      .where(gte(performanceMetrics.timestamp, startTime))
      .orderBy(desc(performanceMetrics.timestamp));
  }

  async createPerformanceMetric(metric: InsertPerformanceMetric): Promise<PerformanceMetric> {
    const [performanceMetric] = await db
      .insert(performanceMetrics)
      .values(metric)
      .returning();
    return performanceMetric;
  }

  // API usage methods
  async getApiUsage(days: number = 7): Promise<any[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return await db
      .select()
      .from(apiUsage)
      .where(gte(apiUsage.date, startDate))
      .orderBy(desc(apiUsage.date));
  }

  async recordApiUsage(service: string, endpoint: string, success: boolean, responseTime: number): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Try to find existing record for today
    const [existingRecord] = await db
      .select()
      .from(apiUsage)
      .where(
        and(
          eq(apiUsage.service, service),
          eq(apiUsage.endpoint, endpoint),
          eq(apiUsage.date, today)
        )
      );

    if (existingRecord) {
      // Update existing record
      const newRequestCount = existingRecord.requestCount + 1;
      const newSuccessCount = existingRecord.successCount + (success ? 1 : 0);
      const newErrorCount = existingRecord.errorCount + (success ? 0 : 1);
      const newAvgResponseTime = 
        (existingRecord.averageResponseTime * existingRecord.requestCount + responseTime) / newRequestCount;

      await db
        .update(apiUsage)
        .set({
          requestCount: newRequestCount,
          successCount: newSuccessCount,
          errorCount: newErrorCount,
          averageResponseTime: newAvgResponseTime.toString()
        })
        .where(eq(apiUsage.id, existingRecord.id));
    } else {
      // Create new record
      await db
        .insert(apiUsage)
        .values({
          service,
          endpoint,
          requestCount: 1,
          successCount: success ? 1 : 0,
          errorCount: success ? 0 : 1,
          averageResponseTime: responseTime.toString(),
          date: today
        });
    }
  }

  // Dashboard statistics methods
  async getDashboardStats(): Promise<any> {
    const [
      totalSessions,
      totalExploits,
      recentToolExecutions,
      recentPerformanceMetrics
    ] = await Promise.all([
      db.select().from(mcpSessions),
      db.select().from(exploitDiscoveries),
      this.getToolExecutions(),
      this.getPerformanceMetrics(1)
    ]);

    const activeSessions = totalSessions.filter(s => s.status === 'running').length;
    const completedSessions = totalSessions.filter(s => s.status === 'completed').length;
    const failedSessions = totalSessions.filter(s => s.status === 'failed').length;

    const criticalExploits = totalExploits.filter(e => e.severity === 'critical').length;
    const highExploits = totalExploits.filter(e => e.severity === 'high').length;

    const totalValueAtRisk = totalExploits.reduce((sum, exploit) => {
      return sum + parseFloat(exploit.valueAtRisk || '0');
    }, 0);

    const successfulExecutions = recentToolExecutions.filter(e => e.status === 'completed').length;
    const successRate = recentToolExecutions.length > 0 
      ? (successfulExecutions / recentToolExecutions.length) * 100 
      : 0;

    return {
      sessions: {
        total: totalSessions.length,
        active: activeSessions,
        completed: completedSessions,
        failed: failedSessions
      },
      exploits: {
        total: totalExploits.length,
        critical: criticalExploits,
        high: highExploits,
        totalValueAtRisk: totalValueAtRisk.toFixed(2)
      },
      performance: {
        totalToolExecutions: recentToolExecutions.length,
        successfulExecutions,
        successRate: successRate.toFixed(2)
      }
    };
  }
}

export const storage = new DatabaseStorage();
