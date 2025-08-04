import { ethers } from 'ethers';
import { BlockchainService } from './blockchain';

interface TokenPrice {
  priceUSD: number;
  priceETH: number;
  liquidityUSD: number;
  priceImpact: number;
  sources: string[];
  confidence: number;
}

interface TokenMetadata {
  symbol: string;
  decimals: number;
  name?: string;
}

export class PriceOracleService {
  private blockchain: BlockchainService;
  private chainlinkFeeds: Map<number, Map<string, string>> = new Map();
  private dexRouters: Map<number, string[]> = new Map();

  constructor() {
    this.blockchain = new BlockchainService();
    this.initializeOracles();
  }

  private initializeOracles() {
    // Chainlink price feeds by chain
    this.chainlinkFeeds.set(1, new Map([
      // Ethereum mainnet feeds
      ['ETH/USD', '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'],
      ['BTC/USD', '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'],
      ['USDC/USD', '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'],
      ['USDT/USD', '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'],
      ['DAI/USD', '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'],
    ]));

    this.chainlinkFeeds.set(56, new Map([
      // BSC feeds
      ['BNB/USD', '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'],
      ['ETH/USD', '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e'],
      ['BTC/USD', '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf'],
    ]));

    this.chainlinkFeeds.set(137, new Map([
      // Polygon feeds
      ['MATIC/USD', '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0'],
      ['ETH/USD', '0xF9680D99D6C9589e2a93a78A04A279e509205945'],
      ['BTC/USD', '0xc907E116054Ad103354f2D350FD2514433D57F6f'],
    ]));

    // DEX routers by chain
    this.dexRouters.set(1, [
      '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
      '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // Sushiswap
    ]);

    this.dexRouters.set(56, [
      '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2
      '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', // PancakeSwap V3
    ]);

    this.dexRouters.set(137, [
      '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap
      '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // Sushiswap Polygon
    ]);
  }

  async getNativeTokenPrice(chainId: number, blockNumber?: string): Promise<number> {
    try {
      const chainFeeds = this.chainlinkFeeds.get(chainId);
      if (!chainFeeds) {
        throw new Error(`No price feeds configured for chain ${chainId}`);
      }

      let feedAddress: string | undefined;
      switch (chainId) {
        case 1:
          feedAddress = chainFeeds.get('ETH/USD');
          break;
        case 56:
          feedAddress = chainFeeds.get('BNB/USD');
          break;
        case 137:
          feedAddress = chainFeeds.get('MATIC/USD');
          break;
        default:
          // Fallback to ETH price for other chains
          const ethFeeds = this.chainlinkFeeds.get(1);
          feedAddress = ethFeeds?.get('ETH/USD');
      }

      if (!feedAddress) {
        throw new Error(`No native token price feed found for chain ${chainId}`);
      }

      const price = await this.getChainlinkPrice(feedAddress, chainId, blockNumber);
      return price;

    } catch (error) {
      console.error(`Error getting native token price for chain ${chainId}:`, error);
      // Fallback to approximate prices
      const fallbackPrices = { 1: 3000, 56: 300, 137: 0.8, 42161: 3000, 10: 3000 };
      return fallbackPrices[chainId] || 3000;
    }
  }

  async getTokenPrice(tokenAddress: string, chainId: number, blockNumber?: string): Promise<TokenPrice> {
    const sources: string[] = [];
    let priceUSD = 0;
    let priceETH = 0;
    let liquidityUSD = 0;
    let priceImpact = 0;
    let confidence = 0;

    try {
      // Try Chainlink first for major tokens
      try {
        const chainlinkPrice = await this.getTokenPriceFromChainlink(tokenAddress, chainId, blockNumber);
        if (chainlinkPrice > 0) {
          priceUSD = chainlinkPrice;
          sources.push('Chainlink');
          confidence += 40;
        }
      } catch (chainlinkError) {
        console.log('Chainlink price not available:', chainlinkError.message);
      }

      // Try DEX aggregation
      try {
        const dexPrice = await this.getTokenPriceFromDEX(tokenAddress, chainId, blockNumber);
        if (dexPrice.priceUSD > 0) {
          if (priceUSD === 0) {
            priceUSD = dexPrice.priceUSD;
          } else {
            // Average with Chainlink if both available
            priceUSD = (priceUSD + dexPrice.priceUSD) / 2;
          }
          
          liquidityUSD = dexPrice.liquidityUSD;
          priceImpact = dexPrice.priceImpact;
          sources.push('DEX');
          confidence += 30;
        }
      } catch (dexError) {
        console.log('DEX price not available:', dexError.message);
      }

      // Convert to ETH price
      if (priceUSD > 0) {
        const nativePrice = await this.getNativeTokenPrice(chainId, blockNumber);
        priceETH = priceUSD / nativePrice;
        confidence += 20;
      }

      // Adjust confidence based on data quality
      if (liquidityUSD > 1000000) confidence += 10;
      if (sources.length > 1) confidence += 10;

      return {
        priceUSD,
        priceETH,
        liquidityUSD,
        priceImpact,
        sources,
        confidence: Math.min(confidence, 100)
      };

    } catch (error) {
      console.error(`Error getting token price for ${tokenAddress}:`, error);
      return {
        priceUSD: 0,
        priceETH: 0,
        liquidityUSD: 0,
        priceImpact: 0,
        sources: [],
        confidence: 0
      };
    }
  }

  async getTokenMetadata(tokenAddress: string, chainId: number): Promise<TokenMetadata> {
    try {
      const provider = this.blockchain.getProvider(chainId);
      const tokenContract = new ethers.Contract(tokenAddress, [
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function name() view returns (string)'
      ], provider);

      const [symbol, decimals, name] = await Promise.allSettled([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name()
      ]);

      return {
        symbol: symbol.status === 'fulfilled' ? symbol.value : 'UNKNOWN',
        decimals: decimals.status === 'fulfilled' ? decimals.value : 18,
        name: name.status === 'fulfilled' ? name.value : undefined
      };

    } catch (error) {
      console.error(`Error getting token metadata for ${tokenAddress}:`, error);
      return {
        symbol: 'UNKNOWN',
        decimals: 18
      };
    }
  }

  private async getChainlinkPrice(feedAddress: string, chainId: number, blockNumber?: string): Promise<number> {
    const provider = this.blockchain.getProvider(chainId);
    const aggregator = new ethers.Contract(feedAddress, [
      'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
    ], provider);

    const blockTag = blockNumber === 'latest' ? 'latest' : parseInt(blockNumber || 'latest');
    const roundData = await aggregator.latestRoundData({ blockTag });
    
    // Chainlink prices are typically 8 decimals
    return parseFloat(ethers.formatUnits(roundData.answer, 8));
  }

  private async getTokenPriceFromChainlink(tokenAddress: string, chainId: number, blockNumber?: string): Promise<number> {
    // Map token addresses to Chainlink feeds
    const tokenFeeds = {
      1: {
        '0xA0b86a33E6441E1c4B37d8c5C7e48a16c1111111': 'USDC/USD', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT/USD', // USDT
        '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI/USD',  // DAI
      }
    };

    const chainTokens = tokenFeeds[chainId];
    if (!chainTokens || !chainTokens[tokenAddress.toLowerCase()]) {
      throw new Error('No Chainlink feed for token');
    }

    const feedKey = chainTokens[tokenAddress.toLowerCase()];
    const chainFeeds = this.chainlinkFeeds.get(chainId);
    const feedAddress = chainFeeds?.get(feedKey);

    if (!feedAddress) {
      throw new Error('Feed address not found');
    }

    return this.getChainlinkPrice(feedAddress, chainId, blockNumber);
  }

  private async getTokenPriceFromDEX(tokenAddress: string, chainId: number, blockNumber?: string): Promise<{
    priceUSD: number;
    liquidityUSD: number;
    priceImpact: number;
  }> {
    const routers = this.dexRouters.get(chainId);
    if (!routers || routers.length === 0) {
      throw new Error('No DEX routers configured for chain');
    }

    const provider = this.blockchain.getProvider(chainId);
    const blockTag = blockNumber === 'latest' ? 'latest' : parseInt(blockNumber || 'latest');

    // Get WETH address for the chain
    const wethAddresses = {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    };

    const wethAddress = wethAddresses[chainId];
    if (!wethAddress) {
      throw new Error('WETH address not configured for chain');
    }

    try {
      // Use Uniswap V2 style router for price discovery
      const routerContract = new ethers.Contract(routers[0], [
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
        'function factory() external pure returns (address)'
      ], provider);

      // Get factory for liquidity check
      const factoryAddress = await routerContract.factory({ blockTag });
      const factoryContract = new ethers.Contract(factoryAddress, [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
      ], provider);

      // Check if pair exists
      const pairAddress = await factoryContract.getPair(tokenAddress, wethAddress, { blockTag });
      if (pairAddress === ethers.ZeroAddress) {
        throw new Error('No liquidity pair found');
      }

      // Get pair reserves for liquidity calculation
      const pairContract = new ethers.Contract(pairAddress, [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() external view returns (address)',
        'function token1() external view returns (address)'
      ], provider);

      const [reserves, token0] = await Promise.all([
        pairContract.getReserves({ blockTag }),
        pairContract.token0({ blockTag })
      ]);

      // Calculate price using 1 token as input
      const amountIn = ethers.parseUnits('1', 18);
      const path = [tokenAddress, wethAddress];
      const amounts = await routerContract.getAmountsOut(amountIn, path, { blockTag });
      
      const tokenPriceInWETH = parseFloat(ethers.formatEther(amounts[1]));
      
      // Get WETH price in USD
      const wethPriceUSD = await this.getNativeTokenPrice(chainId, blockNumber);
      const priceUSD = tokenPriceInWETH * wethPriceUSD;

      // Calculate liquidity
      const reserve0 = parseFloat(ethers.formatEther(reserves.reserve0));
      const reserve1 = parseFloat(ethers.formatEther(reserves.reserve1));
      
      const wethReserve = token0.toLowerCase() === wethAddress.toLowerCase() ? reserve0 : reserve1;
      const liquidityUSD = wethReserve * wethPriceUSD * 2; // Total liquidity

      // Estimate price impact for 1% of reserves
      const tradeSize = liquidityUSD * 0.01;
      const priceImpact = Math.min(tradeSize / liquidityUSD, 0.1); // Cap at 10%

      return {
        priceUSD,
        liquidityUSD,
        priceImpact
      };

    } catch (error) {
      console.error('DEX price fetch error:', error);
      throw error;
    }
  }

  async getStatus(): Promise<any> {
    const chainStatuses = {};
    const supportedChains = [1, 56, 137, 42161, 10];

    for (const chainId of supportedChains) {
      try {
        await this.getNativeTokenPrice(chainId);
        chainStatuses[chainId] = {
          status: 'operational',
          feeds: this.chainlinkFeeds.get(chainId)?.size || 0,
          routers: this.dexRouters.get(chainId)?.length || 0
        };
      } catch (error) {
        chainStatuses[chainId] = {
          status: 'error',
          error: error.message
        };
      }
    }

    return {
      status: 'operational',
      lastCheck: new Date().toISOString(),
      chains: chainStatuses,
      totalFeeds: Array.from(this.chainlinkFeeds.values()).reduce((sum, feeds) => sum + feeds.size, 0),
      totalRouters: Array.from(this.dexRouters.values()).reduce((sum, routers) => sum + routers.length, 0)
    };
  }
}
