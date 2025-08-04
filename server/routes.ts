import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { McpServer } from "./mcp/server";
import { setupSSE } from "./middleware/sse";
import { z } from "zod";
import { insertMcpSessionSchema, insertExploitDiscoverySchema } from "@shared/schema";

const createAnalysisSchema = z.object({
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  blockNumber: z.string().optional(),
  configuration: z.object({
    enableProxyDetection: z.boolean().default(true),
    enableHistoricalAnalysis: z.boolean().default(true),
    enableDetailedTraces: z.boolean().default(false),
  }),
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Setup WebSocket server for MCP communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Initialize MCP Server
  const mcpServer = new McpServer();
  
  // Setup SSE middleware
  setupSSE(app);
  
  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('MCP WebSocket connection established');
    
    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);
        const response = await mcpServer.handleMessage(data);
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      }
    });
    
    ws.on('close', () => {
      console.log('MCP WebSocket connection closed');
    });
  });

  // API Routes
  
  // Get all MCP sessions
  app.get('/api/mcp/sessions', async (req, res) => {
    try {
      const sessions = await storage.getMcpSessions();
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  // Create new MCP analysis session
  app.post('/api/mcp/sessions', async (req, res) => {
    try {
      const validatedData = createAnalysisSchema.parse(req.body);
      
      const sessionData = {
        contractAddress: validatedData.contractAddress,
        chainId: validatedData.chainId,
        blockNumber: validatedData.blockNumber || 'latest',
        configuration: validatedData.configuration,
        userId: null, // TODO: Add authentication
      };

      const session = await storage.createMcpSession(sessionData);
      
      // Start analysis asynchronously
      mcpServer.startAnalysis(session.id, sessionData).catch(console.error);
      
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.errors });
      } else {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
      }
    }
  });

  // Get specific session details
  app.get('/api/mcp/sessions/:id', async (req, res) => {
    try {
      const session = await storage.getMcpSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    } catch (error) {
      console.error('Error fetching session:', error);
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  });

  // Get tool executions for a session
  app.get('/api/mcp/sessions/:id/tools', async (req, res) => {
    try {
      const toolExecutions = await storage.getToolExecutions(req.params.id);
      res.json(toolExecutions);
    } catch (error) {
      console.error('Error fetching tool executions:', error);
      res.status(500).json({ error: 'Failed to fetch tool executions' });
    }
  });

  // Get exploit discoveries
  app.get('/api/exploits', async (req, res) => {
    try {
      const exploits = await storage.getExploitDiscoveries();
      res.json(exploits);
    } catch (error) {
      console.error('Error fetching exploits:', error);
      res.status(500).json({ error: 'Failed to fetch exploits' });
    }
  });

  // Get performance metrics
  app.get('/api/metrics', async (req, res) => {
    try {
      const metrics = await storage.getPerformanceMetrics();
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching metrics:', error);
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  // Get API usage statistics
  app.get('/api/usage', async (req, res) => {
    try {
      const usage = await storage.getApiUsage();
      res.json(usage);
    } catch (error) {
      console.error('Error fetching API usage:', error);
      res.status(500).json({ error: 'Failed to fetch API usage' });
    }
  });

  // SSE endpoint for live activity stream
  app.get('/api/stream/activity', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    res.write('data: {"type":"connected","timestamp":"' + new Date().toISOString() + '"}\n\n');

    // Keep connection alive
    const heartbeat = setInterval(() => {
      res.write('data: {"type":"heartbeat","timestamp":"' + new Date().toISOString() + '"}\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  // MCP Server status
  app.get('/api/mcp/status', async (req, res) => {
    try {
      const status = await mcpServer.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error fetching MCP status:', error);
      res.status(500).json({ error: 'Failed to fetch MCP status' });
    }
  });

  // Direct tool execution endpoints
  app.post('/api/tools/execute/:toolName', async (req, res) => {
    try {
      const { toolName } = req.params;
      const args = req.body;
      
      const result = await mcpServer.executeToolDirectly(toolName, args);
      res.json({
        success: true,
        tool: toolName,
        result
      });
    } catch (error) {
      console.error(`Error executing tool ${req.params.toolName}:`, error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  return httpServer;
}
