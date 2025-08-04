import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';

import { SourceCodeFetcher } from './tools/source-code-fetcher';
import { ConstructorParameters } from './tools/constructor-parameters';
import { StateReader } from './tools/state-reader';
import { CodeSanitizer } from './tools/code-sanitizer';
import { ConcreteExecution } from './tools/concrete-execution';
import { RevenueNormalizer } from './tools/revenue-normalizer';
import { storage } from '../storage';

export class McpServer {
  private server: Server;
  private tools: Map<string, any> = new Map();
  private activeSessions: Map<string, any> = new Map();

  constructor() {
    this.server = new Server({
      name: "a1-agent-mcp-server",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {},
        resources: {}
      }
    });

    this.initializeTools();
    this.setupHandlers();
  }

  private initializeTools() {
    // Initialize all 6 A1 agent tools
    this.tools.set('source_code_fetcher', new SourceCodeFetcher());
    this.tools.set('constructor_parameters', new ConstructorParameters());
    this.tools.set('state_reader', new StateReader());
    this.tools.set('code_sanitizer', new CodeSanitizer());
    this.tools.set('concrete_execution', new ConcreteExecution());
    this.tools.set('revenue_normalizer', new RevenueNormalizer());
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolsList = Array.from(this.tools.entries()).map(([name, tool]) => ({
        name,
        description: tool.getDescription(),
        inputSchema: tool.getInputSchema()
      }));

      return { tools: toolsList };
    });

    // Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      if (!this.tools.has(name)) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const tool = this.tools.get(name);
      const startTime = Date.now();

      try {
        const result = await tool.execute(args);
        const executionTime = Date.now() - startTime;

        // Log tool execution to database
        await storage.createToolExecution({
          sessionId: args.sessionId || null,
          toolName: name,
          status: 'completed',
          input: args,
          output: result,
          executionTime,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        // Log failed execution
        await storage.createToolExecution({
          sessionId: args.sessionId || null,
          toolName: name,
          status: 'failed',
          input: args,
          output: null,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          executionTime,
        });

        throw error;
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "analysis://sessions",
            name: "Active Analysis Sessions",
            description: "List of all active MCP analysis sessions",
            mimeType: "application/json"
          },
          {
            uri: "analysis://exploits",
            name: "Discovered Exploits",
            description: "List of all discovered exploits",
            mimeType: "application/json"
          }
        ]
      };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case "analysis://sessions":
          const sessions = await storage.getMcpSessions();
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(sessions, null, 2)
            }]
          };

        case "analysis://exploits":
          const exploits = await storage.getExploitDiscoveries();
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(exploits, null, 2)
            }]
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  async startAnalysis(sessionId: string, config: any): Promise<void> {
    try {
      // Update session status
      await storage.updateMcpSession(sessionId, { status: 'running' });
      
      // Store session in active sessions
      this.activeSessions.set(sessionId, {
        id: sessionId,
        config,
        startTime: Date.now(),
        status: 'running'
      });

      // Execute analysis pipeline
      await this.executeAnalysisPipeline(sessionId, config);

      // Update session status
      await storage.updateMcpSession(sessionId, { status: 'completed' });
      this.activeSessions.delete(sessionId);

    } catch (error) {
      console.error(`Analysis failed for session ${sessionId}:`, error);
      await storage.updateMcpSession(sessionId, { status: 'failed' });
      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  private async executeAnalysisPipeline(sessionId: string, config: any): Promise<void> {
    const { contractAddress, chainId, blockNumber } = config;

    // Step 1: Fetch source code
    const sourceCodeTool = this.tools.get('source_code_fetcher');
    const sourceCode = await sourceCodeTool.execute({
      sessionId,
      contractAddress,
      chainId,
      blockNumber
    });

    // Step 2: Get constructor parameters
    const constructorTool = this.tools.get('constructor_parameters');
    const constructorParams = await constructorTool.execute({
      sessionId,
      contractAddress,
      chainId
    });

    // Step 3: Read contract state
    const stateReaderTool = this.tools.get('state_reader');
    const contractState = await stateReaderTool.execute({
      sessionId,
      contractAddress,
      chainId,
      blockNumber
    });

    // Step 4: Sanitize code
    const sanitizerTool = this.tools.get('code_sanitizer');
    const sanitizedCode = await sanitizerTool.execute({
      sessionId,
      sourceCode: sourceCode.sourceCode
    });

    // Step 5: Generate and execute exploit
    const executionTool = this.tools.get('concrete_execution');
    const exploitResult = await executionTool.execute({
      sessionId,
      contractAddress,
      chainId,
      blockNumber,
      sourceCode: sanitizedCode.sanitizedCode,
      constructorParams,
      contractState
    });

    // Step 6: Calculate revenue if exploit found
    if (exploitResult.exploitFound) {
      const revenueTool = this.tools.get('revenue_normalizer');
      const revenue = await revenueTool.execute({
        sessionId,
        chainId,
        extractedTokens: exploitResult.extractedTokens,
        blockNumber
      });

      // Store exploit discovery
      await storage.createExploitDiscovery({
        sessionId,
        contractAddress,
        chainId: Number(chainId),
        exploitType: exploitResult.exploitType,
        severity: exploitResult.severity,
        confidence: exploitResult.confidence,
        valueAtRisk: revenue.totalValueUSD,
        proofOfConcept: exploitResult.proofOfConcept,
        description: exploitResult.description,
        validated: true
      });
    }
  }

  async handleMessage(message: any): Promise<any> {
    // Handle MCP protocol messages
    try {
      return await this.server.processRequest(message);
    } catch (error) {
      console.error('MCP message processing error:', error);
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error'
        }
      };
    }
  }

  async getStatus(): Promise<any> {
    const toolStatuses = {};
    
    for (const [name, tool] of this.tools.entries()) {
      try {
        toolStatuses[name] = await tool.getStatus();
      } catch (error) {
        toolStatuses[name] = { status: 'error', error: error.message };
      }
    }

    return {
      server: {
        status: 'operational',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeSessions: this.activeSessions.size
      },
      tools: toolStatuses,
      activeSessions: Array.from(this.activeSessions.values())
    };
  }

  async executeToolDirectly(toolName: string, args: any): Promise<any> {
    // Normalize tool name (convert from kebab-case to snake_case if needed)
    const normalizedName = toolName.replace(/-/g, '_');
    
    if (!this.tools.has(normalizedName)) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const tool = this.tools.get(normalizedName);
    const startTime = Date.now();

    try {
      const result = await tool.execute(args);
      const executionTime = Date.now() - startTime;

      // Log tool execution to database
      await storage.createToolExecution({
        sessionId: args.sessionId || null,
        toolName: normalizedName,
        status: 'completed',
        input: args,
        output: result,
        executionTime,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Log failed execution
      await storage.createToolExecution({
        sessionId: args.sessionId || null,
        toolName: normalizedName,
        status: 'failed',
        input: args,
        output: null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
      });

      throw error;
    }
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
