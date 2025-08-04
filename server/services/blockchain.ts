import { ethers } from 'ethers';
import { EtherscanService } from './etherscan';

export class BlockchainService {
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private etherscan: EtherscanService;

  constructor() {
    this.etherscan = new EtherscanService();
    this.initializeProviders();
  }

  private initializeProviders() {
    const rpcUrls = {
      1: 'https://eth-mainnet.g.alchemy.com/v2/QMEap6jyoJPkSgcqeWBIHfSbWv_zFiog',
      56: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      42161: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      10: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    };

    Object.entries(rpcUrls).forEach(([chainId, url]) => {
      try {
        const provider = new ethers.providers.JsonRpcProvider(url);
        this.providers.set(Number(chainId), provider);
      } catch (error) {
        console.error(`Failed to initialize provider for chain ${chainId}:`, error);
      }
    });
  }

  getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ID ${chainId}`);
    }
    return provider;
  }

  async getContractSourceCode(contractAddress: string, chainId: number): Promise<any> {
    try {
      const sourceCode = await this.etherscan.getSourceCode(contractAddress, chainId);
      if (sourceCode && sourceCode.length > 0) {
        return {
          sourceCode: sourceCode[0].SourceCode,
          abi: sourceCode[0].ABI,
          contractName: sourceCode[0].ContractName,
          compilerVersion: sourceCode[0].CompilerVersion
        };
      }
      return null;
    } catch (error) {
      console.error('Error fetching source code:', error);
      return null;
    }
  }

  async getContract(contractAddress: string, abi: string, chainId: number): Promise<ethers.Contract> {
    const provider = this.getProvider(chainId);
    return new ethers.Contract(contractAddress, JSON.parse(abi), provider);
  }

  async getBlockNumber(chainId: number): Promise<number> {
    const provider = this.getProvider(chainId);
    return await provider.getBlockNumber();
  }

  async getBlock(blockNumber: number | string, chainId: number): Promise<ethers.Block> {
    const provider = this.getProvider(chainId);
    return await provider.getBlock(blockNumber);
  }

  async getTransaction(txHash: string, chainId: number): Promise<ethers.TransactionResponse | null> {
    const provider = this.getProvider(chainId);
    return await provider.getTransaction(txHash);
  }

  async getTransactionReceipt(txHash: string, chainId: number): Promise<ethers.TransactionReceipt | null> {
    const provider = this.getProvider(chainId);
    return await provider.getTransactionReceipt(txHash);
  }

  async getBalance(address: string, chainId: number, blockTag?: string | number): Promise<bigint> {
    const provider = this.getProvider(chainId);
    return await provider.getBalance(address, blockTag);
  }

  async getCode(address: string, chainId: number, blockTag?: string | number): Promise<string> {
    const provider = this.getProvider(chainId);
    return await provider.getCode(address, blockTag);
  }

  async getStorageAt(address: string, position: string, chainId: number, blockTag?: string | number): Promise<string> {
    const provider = this.getProvider(chainId);
    return await provider.getStorage(address, position, blockTag);
  }

  async call(transaction: ethers.TransactionRequest, chainId: number, blockTag?: string | number): Promise<string> {
    const provider = this.getProvider(chainId);
    return await provider.call(transaction, blockTag);
  }

  async estimateGas(transaction: ethers.TransactionRequest, chainId: number): Promise<bigint> {
    const provider = this.getProvider(chainId);
    return await provider.estimateGas(transaction);
  }

  async getGasPrice(chainId: number): Promise<bigint> {
    const provider = this.getProvider(chainId);
    return await provider.getFeeData().then(feeData => feeData.gasPrice || BigInt(0));
  }

  async getLogs(filter: ethers.EventLog, chainId: number): Promise<ethers.Log[]> {
    const provider = this.getProvider(chainId);
    return await provider.getLogs(filter);
  }

  // Multi-call functionality for batch operations
  async multiCall(calls: Array<{
    target: string;
    callData: string;
  }>, chainId: number, blockTag?: string | number): Promise<string[]> {
    const provider = this.getProvider(chainId);
    
    // Use a simple multicall implementation
    const results = [];
    for (const call of calls) {
      try {
        const result = await provider.call({
          to: call.target,
          data: call.callData
        }, blockTag);
        results.push(result);
      } catch (error) {
        results.push('0x');
      }
    }
    
    return results;
  }

  // Fork a network for testing
  async createFork(chainId: number, blockNumber?: number): Promise<string> {
    // This would integrate with Foundry's anvil or similar
    // For now, return a mock fork URL
    const provider = this.getProvider(chainId);
    const latestBlock = blockNumber || await provider.getBlockNumber();
    
    // In production, this would spawn an actual fork
    return `http://localhost:8545/fork/${chainId}/${latestBlock}`;
  }

  // Utility methods
  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  formatUnits(value: bigint, decimals: number = 18): string {
    return ethers.formatUnits(value, decimals);
  }

  parseUnits(value: string, decimals: number = 18): bigint {
    return ethers.parseUnits(value, decimals);
  }

  // Health check for all providers
  async getProvidersStatus(): Promise<Record<number, { status: string; blockNumber?: number; error?: string }>> {
    const status = {};
    
    for (const [chainId, provider] of this.providers.entries()) {
      try {
        const blockNumber = await provider.getBlockNumber();
        status[chainId] = {
          status: 'healthy',
          blockNumber
        };
      } catch (error) {
        status[chainId] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    return status;
  }
}
