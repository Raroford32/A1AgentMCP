import axios from 'axios';

export class EtherscanService {
  private apiKey: string;
  private baseUrl = 'https://api.etherscan.io/v2/api';
  private rateLimiter: Map<string, number> = new Map();

  constructor() {
    this.apiKey = process.env.ETHERSCAN_API_KEY || process.env.ETHERSCAN_KEY || '';
    if (!this.apiKey) {
      console.warn('Etherscan API key not found in environment variables');
    }
  }

  private async rateLimit(endpoint: string): Promise<void> {
    const now = Date.now();
    const lastCall = this.rateLimiter.get(endpoint) || 0;
    const timeSinceLastCall = now - lastCall;
    const minInterval = 200; // 200ms between calls

    if (timeSinceLastCall < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLastCall));
    }

    this.rateLimiter.set(endpoint, Date.now());
  }

  private async makeRequest(params: Record<string, any>): Promise<any> {
    await this.rateLimit(params.module + params.action);

    const url = new URL(this.baseUrl);
    
    // Add required parameters
    url.searchParams.set('apikey', this.apiKey);
    
    // Add all provided parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value.toString());
      }
    });

    try {
      const response = await axios.get(url.toString());
      const data = response.data;
      
      if (data.status === '0' && data.message !== 'No transactions found') {
        throw new Error(`Etherscan API Error: ${data.message || data.result}`);
      }

      return data.result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Etherscan API request failed:', error.response?.data || error.message);
        throw new Error(`HTTP ${error.response?.status}: ${error.response?.statusText || error.message}`);
      }
      console.error('Etherscan API request failed:', error);
      throw error;
    }
  }

  async getSourceCode(contractAddress: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'contract',
      action: 'getsourcecode',
      address: contractAddress
    });
  }

  async getContractCreation(contractAddress: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: contractAddress
    });
  }

  async getTransaction(txHash: string, chainId: number): Promise<any> {
    const result = await this.makeRequest({
      chainid: chainId,
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: txHash
    });

    // Convert hex values to decimal for easier processing
    if (result) {
      return {
        ...result,
        blockNumber: result.blockNumber ? parseInt(result.blockNumber, 16) : null,
        gasUsed: result.gas ? parseInt(result.gas, 16) : null,
        gasPrice: result.gasPrice ? parseInt(result.gasPrice, 16).toString() : null,
        value: result.value || '0'
      };
    }

    return result;
  }

  async getBlockByNumber(blockNumber: string | number, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'proxy',
      action: 'eth_getBlockByNumber',
      tag: typeof blockNumber === 'string' ? blockNumber : `0x${blockNumber.toString(16)}`,
      boolean: 'false'
    });
  }

  async getStorageAt(contractAddress: string, position: string, chainId: number, blockNumber?: string): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'proxy',
      action: 'eth_getStorageAt',
      address: contractAddress,
      position: position,
      tag: blockNumber || 'latest'
    });
  }

  async getBalance(address: string, chainId: number, blockNumber?: string): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'account',
      action: 'balance',
      address: address,
      tag: blockNumber || 'latest'
    });
  }

  async getTokenBalance(contractAddress: string, address: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'account',
      action: 'tokenbalance',
      contractaddress: contractAddress,
      address: address,
      tag: 'latest'
    });
  }

  async getTokenSupply(contractAddress: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'stats',
      action: 'tokensupply',
      contractaddress: contractAddress
    });
  }

  async getTokenInfo(contractAddress: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'token',
      action: 'tokeninfo',
      contractaddress: contractAddress
    });
  }

  async getGasOracle(chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'gastracker',
      action: 'gasoracle'
    });
  }

  async getTransactionList(address: string, chainId: number, startblock?: number, endblock?: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'account',
      action: 'txlist',
      address: address,
      startblock: startblock || 0,
      endblock: endblock || 99999999,
      page: 1,
      offset: 1000,
      sort: 'desc'
    });
  }

  async getInternalTransactions(address: string, chainId: number): Promise<any> {
    return this.makeRequest({
      chainid: chainId,
      module: 'account',
      action: 'txlistinternal',
      address: address,
      page: 1,
      offset: 1000,
      sort: 'desc'
    });
  }

  async getUsage(): Promise<any> {
    try {
      return await this.makeRequest({
        chainid: 1, // Default to Ethereum for usage stats
        module: 'usage',
        action: 'usage'
      });
    } catch (error) {
      console.error('Error fetching API usage:', error);
      return null;
    }
  }

  // Utility method to get chain-specific endpoints
  getChainInfo(chainId: number): { name: string, symbol: string, explorer: string } {
    const chains = {
      1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
      56: { name: 'BSC', symbol: 'BNB', explorer: 'https://bscscan.com' },
      137: { name: 'Polygon', symbol: 'MATIC', explorer: 'https://polygonscan.com' },
      42161: { name: 'Arbitrum', symbol: 'ETH', explorer: 'https://arbiscan.io' },
      10: { name: 'Optimism', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io' },
      8453: { name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org' },
      534352: { name: 'Scroll', symbol: 'ETH', explorer: 'https://scrollscan.com' },
      81457: { name: 'Blast', symbol: 'ETH', explorer: 'https://blastscan.io' }
    };

    return chains[chainId] || { name: 'Unknown', symbol: 'ETH', explorer: '' };
  }
}
