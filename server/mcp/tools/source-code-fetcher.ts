import { EtherscanService } from '../../services/etherscan';
import { z } from 'zod';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  blockNumber: z.string().optional(),
});

export class SourceCodeFetcher {
  private etherscan: EtherscanService;

  constructor() {
    this.etherscan = new EtherscanService();
  }

  getDescription(): string {
    return "Fetches verified source code from Etherscan with proxy pattern detection and multi-file contract support";
  }

  getInputSchema(): any {
    return inputSchema.shape;
  }

  async execute(args: z.infer<typeof inputSchema>): Promise<any> {
    const { contractAddress, chainId, blockNumber } = inputSchema.parse(args);

    try {
      // First, get the contract source code
      const sourceCodeResponse = await this.etherscan.getSourceCode(contractAddress, chainId);
      
      if (!sourceCodeResponse || sourceCodeResponse.length === 0) {
        throw new Error('No source code found for contract');
      }

      const contractInfo = sourceCodeResponse[0];
      let implementationAddress = contractAddress;
      let isProxy = false;
      let proxyType = null;

      // Check if this is a proxy contract
      if (contractInfo.Proxy === '1' || this.isProxyPattern(contractInfo.SourceCode)) {
        isProxy = true;
        proxyType = this.detectProxyType(contractInfo.SourceCode);
        
        // Try to get implementation address
        implementationAddress = await this.getImplementationAddress(contractAddress, chainId, blockNumber);
        
        // If we found an implementation, get its source code too
        if (implementationAddress !== contractAddress) {
          const implSourceResponse = await this.etherscan.getSourceCode(implementationAddress, chainId);
          if (implSourceResponse && implSourceResponse.length > 0) {
            contractInfo.ImplementationSourceCode = implSourceResponse[0].SourceCode;
            contractInfo.ImplementationABI = implSourceResponse[0].ABI;
          }
        }
      }

      // Parse multi-file contracts if source code is a JSON object
      let sourceFiles = {};
      try {
        if (contractInfo.SourceCode.startsWith('{')) {
          const parsed = JSON.parse(contractInfo.SourceCode.slice(1, -1)); // Remove outer braces
          if (parsed.sources) {
            sourceFiles = parsed.sources;
          }
        } else {
          sourceFiles = {
            [`${contractInfo.ContractName}.sol`]: {
              content: contractInfo.SourceCode
            }
          };
        }
      } catch (e) {
        sourceFiles = {
          [`${contractInfo.ContractName}.sol`]: {
            content: contractInfo.SourceCode
          }
        };
      }

      return {
        contractAddress,
        implementationAddress,
        isProxy,
        proxyType,
        contractName: contractInfo.ContractName,
        compilerVersion: contractInfo.CompilerVersion,
        optimizationUsed: contractInfo.OptimizationUsed,
        runs: contractInfo.Runs,
        constructorArguments: contractInfo.ConstructorArguments,
        evmVersion: contractInfo.EVMVersion,
        library: contractInfo.Library,
        licenseType: contractInfo.LicenseType,
        swarmSource: contractInfo.SwarmSource,
        abi: contractInfo.ABI,
        sourceCode: contractInfo.SourceCode,
        sourceFiles,
        implementationSourceCode: contractInfo.ImplementationSourceCode,
        implementationABI: contractInfo.ImplementationABI,
        verificationDate: new Date().toISOString(),
      };

    } catch (error) {
      throw new Error(`Source code fetching failed: ${error.message}`);
    }
  }

  private isProxyPattern(sourceCode: string): boolean {
    const proxyPatterns = [
      'delegatecall',
      'Proxy',
      'Implementation',
      'upgradeable',
      'EIP1967',
      'beacon',
      'minimal proxy',
      'clone'
    ];

    return proxyPatterns.some(pattern => 
      sourceCode.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private detectProxyType(sourceCode: string): string {
    const patterns = {
      'EIP-1967': ['_IMPLEMENTATION_SLOT', '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'],
      'OpenZeppelin': ['UpgradeableProxy', 'TransparentUpgradeableProxy', 'BeaconProxy'],
      'Minimal Proxy': ['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', 'EIP-1167'],
      'Diamond': ['Diamond', 'facet', 'DiamondCut'],
      'Custom': ['delegatecall', 'assembly']
    };

    for (const [type, markers] of Object.entries(patterns)) {
      if (markers.some(marker => sourceCode.includes(marker))) {
        return type;
      }
    }

    return 'Unknown';
  }

  private async getImplementationAddress(proxyAddress: string, chainId: number, blockNumber?: string): Promise<string> {
    try {
      // Try common implementation slots
      const implementationSlots = [
        '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', // EIP-1967
        '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3', // Alternative slot
      ];

      for (const slot of implementationSlots) {
        try {
          const result = await this.etherscan.getStorageAt(proxyAddress, slot, chainId, blockNumber);
          if (result && result !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
            // Extract address from storage (last 20 bytes)
            const address = '0x' + result.slice(-40);
            if (address !== '0x0000000000000000000000000000000000000000') {
              return address;
            }
          }
        } catch (e) {
          // Continue to next slot
        }
      }

      // If no implementation found, return original address
      return proxyAddress;
    } catch (error) {
      console.error('Error getting implementation address:', error);
      return proxyAddress;
    }
  }

  async getStatus(): Promise<any> {
    try {
      const testResult = await this.etherscan.getSourceCode('0x742d35Cc4Bf426A3C1f5E486D9CBa471F861BC4A', 1);
      return {
        status: 'operational',
        lastCheck: new Date().toISOString(),
        etherscanConnected: !!testResult
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
