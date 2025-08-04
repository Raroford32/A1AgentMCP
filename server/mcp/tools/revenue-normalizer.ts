import { PriceOracleService } from '../../services/price-oracle';
import { ethers } from 'ethers';
import { z } from 'zod';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  chainId: z.number().int().positive(),
  extractedTokens: z.array(z.object({
    address: z.string(),
    amount: z.string(),
    symbol: z.string().optional(),
    decimals: z.number().optional()
  })),
  blockNumber: z.string().optional(),
  gasUsed: z.number().optional(),
  gasPrice: z.string().optional(),
});

export class RevenueNormalizer {
  private priceOracle: PriceOracleService;

  constructor() {
    this.priceOracle = new PriceOracleService();
  }

  getDescription(): string {
    return "Normalizes extracted token values to USD using multi-DEX price aggregation and real-time feeds";
  }

  getInputSchema(): any {
    return inputSchema.shape;
  }

  async execute(args: z.infer<typeof inputSchema>): Promise<any> {
    const { chainId, extractedTokens, blockNumber, gasUsed, gasPrice } = inputSchema.parse(args);

    try {
      const normalizedTokens = [];
      let totalValueUSD = 0;
      let totalValueETH = 0;

      // Get native token price (ETH/BNB)
      const nativeTokenPrice = await this.priceOracle.getNativeTokenPrice(chainId, blockNumber);

      // Calculate gas costs
      const gasCosts = this.calculateGasCosts(gasUsed, gasPrice, nativeTokenPrice);

      // Process each extracted token
      for (const token of extractedTokens) {
        try {
          const normalizedToken = await this.normalizeToken(token, chainId, blockNumber);
          normalizedTokens.push(normalizedToken);
          
          totalValueUSD += normalizedToken.valueUSD;
          totalValueETH += normalizedToken.valueETH;
          
        } catch (error) {
          console.error(`Error normalizing token ${token.address}:`, error);
          
          // Add token with error information
          normalizedTokens.push({
            ...token,
            valueUSD: 0,
            valueETH: 0,
            priceUSD: 0,
            priceETH: 0,
            error: error.message,
            liquidity: 'unknown'
          });
        }
      }

      // Calculate net profit (revenue - gas costs)
      const netProfitUSD = totalValueUSD - gasCosts.costUSD;
      const netProfitETH = totalValueETH - gasCosts.costETH;

      // Get market data for profit assessment
      const marketData = await this.getMarketContext(chainId, normalizedTokens);

      return {
        chainId,
        blockNumber: blockNumber || 'latest',
        timestamp: new Date().toISOString(),
        nativeTokenPrice,
        extractedTokens: normalizedTokens,
        totalValueUSD: Number(totalValueUSD.toFixed(2)),
        totalValueETH: Number(totalValueETH.toFixed(6)),
        gasCosts,
        netProfitUSD: Number(netProfitUSD.toFixed(2)),
        netProfitETH: Number(netProfitETH.toFixed(6)),
        isProfitable: netProfitUSD > 0,
        profitabilityRatio: totalValueUSD > 0 ? Number((netProfitUSD / totalValueUSD).toFixed(4)) : 0,
        marketData,
        summary: {
          totalTokens: extractedTokens.length,
          successfulNormalizations: normalizedTokens.filter(t => !t.error).length,
          highLiquidityTokens: normalizedTokens.filter(t => t.liquidity === 'high').length,
          riskLevel: this.assessRiskLevel(normalizedTokens, netProfitUSD)
        }
      };

    } catch (error) {
      throw new Error(`Revenue normalization failed: ${error.message}`);
    }
  }

  private async normalizeToken(token: any, chainId: number, blockNumber?: string): Promise<any> {
    // Get token metadata if not provided
    let tokenMetadata = {
      symbol: token.symbol,
      decimals: token.decimals
    };

    if (!tokenMetadata.symbol || !tokenMetadata.decimals) {
      tokenMetadata = await this.priceOracle.getTokenMetadata(token.address, chainId);
    }

    // Convert amount to decimal format
    const decimals = tokenMetadata.decimals || 18;
    const amountDecimal = ethers.formatUnits(token.amount, decimals);

    // Get token price from multiple sources
    const priceData = await this.priceOracle.getTokenPrice(token.address, chainId, blockNumber);
    
    // Calculate values
    const valueUSD = parseFloat(amountDecimal) * priceData.priceUSD;
    const valueETH = parseFloat(amountDecimal) * priceData.priceETH;

    // Assess liquidity
    const liquidity = this.assessLiquidity(priceData.liquidityUSD);

    return {
      address: token.address,
      symbol: tokenMetadata.symbol,
      decimals,
      amount: token.amount,
      amountDecimal: Number(parseFloat(amountDecimal).toFixed(6)),
      priceUSD: Number(priceData.priceUSD.toFixed(6)),
      priceETH: Number(priceData.priceETH.toFixed(10)),
      valueUSD: Number(valueUSD.toFixed(2)),
      valueETH: Number(valueETH.toFixed(6)),
      liquidity,
      liquidityUSD: priceData.liquidityUSD,
      priceImpact: priceData.priceImpact,
      sources: priceData.sources,
      confidence: priceData.confidence
    };
  }

  private calculateGasCosts(gasUsed?: number, gasPrice?: string, nativeTokenPrice?: number): any {
    if (!gasUsed || !gasPrice || !nativeTokenPrice) {
      return {
        gasUsed: gasUsed || 0,
        gasPrice: gasPrice || '0',
        costETH: 0,
        costUSD: 0,
        estimated: true
      };
    }

    const gasPriceWei = ethers.parseUnits(gasPrice, 'gwei');
    const gasCostWei = BigInt(gasUsed) * gasPriceWei;
    const gasCostETH = parseFloat(ethers.formatEther(gasCostWei));
    const gasCostUSD = gasCostETH * nativeTokenPrice;

    return {
      gasUsed,
      gasPrice,
      costETH: Number(gasCostETH.toFixed(6)),
      costUSD: Number(gasCostUSD.toFixed(2)),
      estimated: false
    };
  }

  private assessLiquidity(liquidityUSD: number): string {
    if (liquidityUSD > 1000000) return 'high';
    if (liquidityUSD > 100000) return 'medium';
    if (liquidityUSD > 10000) return 'low';
    return 'very-low';
  }

  private async getMarketContext(chainId: number, tokens: any[]): Promise<any> {
    try {
      const context = {
        timestamp: new Date().toISOString(),
        totalLiquidity: tokens.reduce((sum, token) => sum + (token.liquidityUSD || 0), 0),
        averagePriceImpact: tokens.length > 0 ? 
          tokens.reduce((sum, token) => sum + (token.priceImpact || 0), 0) / tokens.length : 0,
        highLiquidityCount: tokens.filter(t => t.liquidity === 'high').length,
        riskTokens: tokens.filter(t => t.liquidity === 'very-low' || (t.priceImpact && t.priceImpact > 0.05)).length
      };

      return context;
    } catch (error) {
      console.error('Error getting market context:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  private assessRiskLevel(tokens: any[], netProfitUSD: number): string {
    let riskScore = 0;

    // High risk factors
    const lowLiquidityTokens = tokens.filter(t => t.liquidity === 'very-low' || t.liquidity === 'low').length;
    const highImpactTokens = tokens.filter(t => t.priceImpact && t.priceImpact > 0.05).length;
    const unknownTokens = tokens.filter(t => t.error || !t.symbol).length;

    riskScore += lowLiquidityTokens * 2;
    riskScore += highImpactTokens * 3;
    riskScore += unknownTokens * 4;

    // Low profitability increases risk
    if (netProfitUSD < 1000) riskScore += 2;
    if (netProfitUSD < 100) riskScore += 3;

    if (riskScore >= 8) return 'very-high';
    if (riskScore >= 5) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }

  async getStatus(): Promise<any> {
    try {
      const priceStatus = await this.priceOracle.getStatus();
      return {
        status: 'operational',
        lastCheck: new Date().toISOString(),
        priceOracleStatus: priceStatus,
        supportedChains: [1, 56, 137, 42161, 10] // ETH, BSC, Polygon, Arbitrum, Optimism
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
