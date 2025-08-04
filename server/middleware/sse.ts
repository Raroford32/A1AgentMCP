import type { Express, Request, Response } from 'express';

interface SSEConnection {
  id: string;
  response: Response;
  lastHeartbeat: number;
}

class SSEManager {
  private connections: Map<string, SSEConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);

    // Clean up stale connections every minute
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 60000);
  }

  addConnection(id: string, response: Response): void {
    // Setup SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send initial connection event
    this.sendEvent(response, {
      type: 'connected',
      timestamp: new Date().toISOString(),
      connectionId: id
    });

    // Store connection
    this.connections.set(id, {
      id,
      response,
      lastHeartbeat: Date.now()
    });

    // Handle client disconnect
    response.on('close', () => {
      this.removeConnection(id);
    });

    console.log(`SSE connection established: ${id}`);
  }

  removeConnection(id: string): void {
    this.connections.delete(id);
    console.log(`SSE connection closed: ${id}`);
  }

  broadcast(event: any): void {
    const eventData = {
      ...event,
      timestamp: new Date().toISOString(),
      id: this.generateEventId()
    };

    for (const [id, connection] of this.connections.entries()) {
      try {
        this.sendEvent(connection.response, eventData);
      } catch (error) {
        console.error(`Error broadcasting to connection ${id}:`, error);
        this.removeConnection(id);
      }
    }
  }

  sendToConnection(connectionId: string, event: any): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      const eventData = {
        ...event,
        timestamp: new Date().toISOString(),
        id: this.generateEventId()
      };

      try {
        this.sendEvent(connection.response, eventData);
      } catch (error) {
        console.error(`Error sending to connection ${connectionId}:`, error);
        this.removeConnection(connectionId);
      }
    }
  }

  private sendEvent(response: Response, data: any): void {
    const eventString = `data: ${JSON.stringify(data)}\n\n`;
    response.write(eventString);
  }

  private sendHeartbeat(): void {
    const heartbeatEvent = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      activeConnections: this.connections.size
    };

    for (const [id, connection] of this.connections.entries()) {
      try {
        this.sendEvent(connection.response, heartbeatEvent);
        connection.lastHeartbeat = Date.now();
      } catch (error) {
        console.error(`Heartbeat failed for connection ${id}:`, error);
        this.removeConnection(id);
      }
    }
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, connection] of this.connections.entries()) {
      if (now - connection.lastHeartbeat > staleThreshold) {
        console.log(`Cleaning up stale connection: ${id}`);
        this.removeConnection(id);
      }
    }
  }

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getConnections(): string[] {
    return Array.from(this.connections.keys());
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const [id, connection] of this.connections.entries()) {
      try {
        connection.response.end();
      } catch (error) {
        console.error(`Error closing connection ${id}:`, error);
      }
    }

    this.connections.clear();
  }
}

// Global SSE manager instance
export const sseManager = new SSEManager();

export function setupSSE(app: Express): void {
  // SSE endpoint for Source Code Fetcher Tool
  app.get('/sse/tools/source-code-fetcher', (req: Request, res: Response) => {
    const connectionId = `source-code-fetcher-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  // SSE endpoint for Constructor Parameters Tool
  app.get('/sse/tools/constructor-parameters', (req: Request, res: Response) => {
    const connectionId = `constructor-parameters-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  // SSE endpoint for State Reader Tool
  app.get('/sse/tools/state-reader', (req: Request, res: Response) => {
    const connectionId = `state-reader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  // SSE endpoint for Code Sanitizer Tool
  app.get('/sse/tools/code-sanitizer', (req: Request, res: Response) => {
    const connectionId = `code-sanitizer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  // SSE endpoint for Concrete Execution Tool
  app.get('/sse/tools/concrete-execution', (req: Request, res: Response) => {
    const connectionId = `concrete-execution-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  // SSE endpoint for Revenue Normalizer Tool
  app.get('/sse/tools/revenue-normalizer', (req: Request, res: Response) => {
    const connectionId = `revenue-normalizer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseManager.addConnection(connectionId, res);
  });

  console.log('A1 Agent MCP Tool SSE endpoints configured');
  console.log('Available SSE endpoints:');
  console.log('  - /sse/tools/source-code-fetcher');
  console.log('  - /sse/tools/constructor-parameters');
  console.log('  - /sse/tools/state-reader');
  console.log('  - /sse/tools/code-sanitizer');
  console.log('  - /sse/tools/concrete-execution');
  console.log('  - /sse/tools/revenue-normalizer');
}

// Helper functions for broadcasting specific events
export function broadcastToolExecution(toolName: string, status: string, result?: any): void {
  sseManager.broadcast({
    type: 'tool_execution',
    toolName,
    status,
    result,
    category: 'activity'
  });
}

export function broadcastExploitDiscovery(exploit: any): void {
  sseManager.broadcast({
    type: 'exploit_discovery',
    exploit,
    category: 'security'
  });
}

export function broadcastSessionUpdate(sessionId: string, status: string, progress?: number): void {
  sseManager.broadcast({
    type: 'session_update',
    sessionId,
    status,
    progress,
    category: 'session'
  });
}

export function broadcastPerformanceMetric(metric: any): void {
  sseManager.broadcast({
    type: 'performance_metric',
    metric,
    category: 'performance'
  });
}

export function broadcastSystemAlert(level: 'info' | 'warning' | 'error', message: string, details?: any): void {
  sseManager.broadcast({
    type: 'system_alert',
    level,
    message,
    details,
    category: 'system'
  });
}
