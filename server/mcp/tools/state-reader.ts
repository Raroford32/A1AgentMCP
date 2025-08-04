import { BlockchainService } from '../../services/blockchain';
import { ethers } from 'ethers';
import { z } from 'zod';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  blockNumber: z.string().optional(),
  abi: z.string().optional(),
});

export class StateReader {
  private blockchain: BlockchainService;

  constructor() {
    this.blockchain = new BlockchainService();
  }

  getDescription(): string {
    return "Reads contract state through batch RPC calls with automatic chunking and historical state queries";
  }

  getInputSchema(): any {
    return inputSchema.shape;
  }

  async execute(args: z.infer<typeof inputSchema>): Promise<any> {
    const { contractAddress, chainId, blockNumber, abi } = inputSchema.parse(args);

    try {
      const provider = this.blockchain.getProvider(chainId);
      const blockTag = blockNumber === 'latest' ? 'latest' : parseInt(blockNumber || 'latest');

      // Get contract ABI if not provided
      let contractABI = abi;
      if (!contractABI) {
        const sourceCode = await this.blockchain.getContractSourceCode(contractAddress, chainId);
        contractABI = sourceCode?.abi;
      }

      if (!contractABI) {
        throw new Error('Contract ABI not available');
      }

      const parsedABI = JSON.parse(contractABI);
      const contract = new ethers.Contract(contractAddress, parsedABI, provider);

      // Filter view/pure functions
      const viewFunctions = parsedABI.filter((item: any) => 
        item.type === 'function' && 
        (item.stateMutability === 'view' || item.stateMutability === 'pure') &&
        item.inputs.length === 0 // Only functions with no parameters for now
      );

      // Batch call view functions
      const stateData = {};
      const errors = {};

      // Execute in chunks to respect rate limits
      const chunkSize = 10;
      for (let i = 0; i < viewFunctions.length; i += chunkSize) {
        const chunk = viewFunctions.slice(i, i + chunkSize);
        
        const promises = chunk.map(async (func: any) => {
          try {
            const result = await contract[func.name]({ blockTag });
            return { name: func.name, result: this.formatResult(result, func.outputs) };
          } catch (error) {
            return { name: func.name, error: error.message };
          }
        });

        const results = await Promise.allSettled(promises);
        
        results.forEach((result, index) => {
          const funcName = chunk[index].name;
          if (result.status === 'fulfilled') {
            if (result.value.error) {
              errors[funcName] = result.value.error;
            } else {
              stateData[funcName] = result.value.result;
            }
          } else {
            errors[funcName] = result.reason?.message || 'Unknown error';
          }
        });

        // Rate limiting delay
        if (i + chunkSize < viewFunctions.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Get basic contract information
      const code = await provider.getCode(contractAddress, blockTag);
      const balance = await provider.getBalance(contractAddress, blockTag);

      // Get storage slots for critical patterns
      const storageSlots = await this.readCriticalStorageSlots(contractAddress, chainId, blockTag);

      // Analyze state for common patterns
      const patterns = this.analyzeStatePatterns(stateData, storageSlots);

      return {
        contractAddress,
        chainId,
        blockNumber: blockTag,
        timestamp: new Date().toISOString(),
        contractBalance: ethers.formatEther(balance),
        codeSize: (code.length - 2) / 2, // Remove 0x and divide by 2 for bytes
        stateData,
        storageSlots,
        viewFunctions: viewFunctions.map(f => ({
          name: f.name,
          outputs: f.outputs,
          stateMutability: f.stateMutability
        })),
        errors,
        patterns,
        totalViewFunctions: viewFunctions.length,
        successfulCalls: Object.keys(stateData).length,
        failedCalls: Object.keys(errors).length
      };

    } catch (error) {
      throw new Error(`State reading failed: ${error.message}`);
    }
  }

  private formatResult(result: any, outputs: any[]): any {
    if (!outputs || outputs.length === 0) {
      return result;
    }

    if (outputs.length === 1) {
      return this.formatValue(result, outputs[0].type);
    }

    // Multiple outputs - return as object
    const formatted = {};
    outputs.forEach((output, index) => {
      const key = output.name || `output${index}`;
      formatted[key] = this.formatValue(result[index], output.type);
    });

    return formatted;
  }

  private formatValue(value: any, type: string): any {
    try {
      if (type.includes('uint') || type.includes('int')) {
        return value.toString();
      } else if (type === 'address') {
        return value;
      } else if (type === 'bool') {
        return Boolean(value);
      } else if (type.includes('bytes')) {
        return value;
      } else if (type === 'string') {
        return value;
      } else if (type.includes('[]')) {
        return Array.isArray(value) ? value.map(v => this.formatValue(v, type.replace('[]', ''))) : value;
      }
    } catch (error) {
      console.error('Value formatting error:', error);
    }
    
    return value;
  }

  private async readCriticalStorageSlots(contractAddress: string, chainId: number, blockTag: any): Promise<any> {
    const provider = this.blockchain.getProvider(chainId);
    const criticalSlots = {
      // Common ERC-20 storage slots
      totalSupply: '0x2', // slot 2
      // Common proxy slots
      implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
      // Common ownership slots
      owner: '0x0', // slot 0 often contains owner
    };

    const storageData = {};

    for (const [key, slot] of Object.entries(criticalSlots)) {
      try {
        const value = await provider.getStorage(contractAddress, slot, blockTag);
        if (value !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          storageData[key] = value;
        }
      } catch (error) {
        // Ignore storage read errors
      }
    }

    return storageData;
  }

  private analyzeStatePatterns(stateData: any, storageSlots: any): any {
    const patterns = {
      hasOwnership: false,
      hasPausability: false,
      hasUpgradeability: false,
      hasReentrancyGuard: false,
      tokenType: null,
      suspiciousPatterns: []
    };

    // Check for ownership patterns
    const ownershipKeys = ['owner', 'admin', '_owner', 'governance'];
    patterns.hasOwnership = ownershipKeys.some(key => 
      Object.keys(stateData).some(stateKey => 
        stateKey.toLowerCase().includes(key.toLowerCase())
      )
    );

    // Check for pausability
    const pauseKeys = ['paused', 'isPaused', '_paused'];
    patterns.hasPausability = pauseKeys.some(key => 
      Object.keys(stateData).some(stateKey => 
        stateKey.toLowerCase().includes(key.toLowerCase())
      )
    );

    // Check for upgradeability
    patterns.hasUpgradeability = !!storageSlots.implementation || !!storageSlots.admin;

    // Detect token type
    if (stateData.name && stateData.symbol && stateData.totalSupply) {
      patterns.tokenType = 'ERC-20';
    }

    // Check for suspicious patterns
    if (stateData.balanceOf && stateData.totalSupply) {
      patterns.suspiciousPatterns.push('Token contract with balance tracking');
    }

    if (patterns.hasOwnership && patterns.hasPausability) {
      patterns.suspiciousPatterns.push('Centralized control with pause functionality');
    }

    return patterns;
  }

  async getStatus(): Promise<any> {
    try {
      const provider = this.blockchain.getProvider(1);
      const blockNumber = await provider.getBlockNumber();
      
      return {
        status: 'operational',
        lastCheck: new Date().toISOString(),
        latestBlock: blockNumber,
        providerConnected: true
      };
    } catch (error) {
      return {
        status: 'error',
        lastCheck: new Date().toISOString(),
        error: error.message
      };
    }
  }
}
