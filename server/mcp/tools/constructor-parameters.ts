import { EtherscanService } from '../../services/etherscan';
import { ethers } from 'ethers';
import { z } from 'zod';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
});

export class ConstructorParameters {
  private etherscan: EtherscanService;

  constructor() {
    this.etherscan = new EtherscanService();
  }

  getDescription(): string {
    return "Extracts and decodes constructor parameters from contract deployment transaction with ABI-based type inference";
  }

  getInputSchema(): any {
    return inputSchema.shape;
  }

  async execute(args: z.infer<typeof inputSchema>): Promise<any> {
    const { contractAddress, chainId } = inputSchema.parse(args);

    try {
      // Get contract creation transaction
      const contractCreation = await this.etherscan.getContractCreation(contractAddress, chainId);
      
      if (!contractCreation || contractCreation.length === 0) {
        throw new Error('Contract creation transaction not found');
      }

      const creationTx = contractCreation[0];
      const deploymentTxHash = creationTx.txHash;

      // Get deployment transaction details
      const txDetails = await this.etherscan.getTransaction(deploymentTxHash, chainId);
      
      if (!txDetails) {
        throw new Error('Deployment transaction details not found');
      }

      // Get contract source code to extract constructor ABI
      const sourceCodeResponse = await this.etherscan.getSourceCode(contractAddress, chainId);
      
      if (!sourceCodeResponse || sourceCodeResponse.length === 0) {
        throw new Error('Source code not available for parameter decoding');
      }

      const contractInfo = sourceCodeResponse[0];
      let abi;
      
      try {
        abi = JSON.parse(contractInfo.ABI);
      } catch (e) {
        throw new Error('Invalid ABI format');
      }

      // Find constructor in ABI
      const constructor = abi.find((item: any) => item.type === 'constructor');
      
      if (!constructor) {
        return {
          contractAddress,
          deploymentTxHash,
          hasConstructor: false,
          parameters: [],
          rawConstructorArgs: contractInfo.ConstructorArguments || '',
          decodedParameters: null
        };
      }

      // Decode constructor parameters
      let decodedParameters = null;
      let parameters = [];

      if (contractInfo.ConstructorArguments && contractInfo.ConstructorArguments.length > 0) {
        try {
          // Remove '0x' prefix if present
          const constructorArgs = contractInfo.ConstructorArguments.startsWith('0x') 
            ? contractInfo.ConstructorArguments.slice(2) 
            : contractInfo.ConstructorArguments;

          // Create ethers interface for decoding
          const contractInterface = new ethers.Interface(abi);
          
          // Decode constructor arguments
          const decoded = contractInterface.decodeFunctionData(constructor, '0x' + constructorArgs);
          
          // Map decoded values to parameter names
          parameters = constructor.inputs.map((input: any, index: number) => ({
            name: input.name || `param${index}`,
            type: input.type,
            value: this.formatValue(decoded[index], input.type),
            rawValue: decoded[index]
          }));

          decodedParameters = {
            types: constructor.inputs.map((input: any) => input.type),
            names: constructor.inputs.map((input: any) => input.name || `param${input.index || 0}`),
            values: decoded.map((value, index) => this.formatValue(value, constructor.inputs[index].type))
          };

        } catch (decodeError) {
          console.error('Constructor parameter decoding failed:', decodeError);
          
          // Fallback: try to parse raw constructor arguments
          parameters = await this.parseRawConstructorArgs(
            contractInfo.ConstructorArguments, 
            constructor.inputs
          );
        }
      }

      // Get additional deployment context
      const deploymentBlock = await this.etherscan.getBlockByNumber(txDetails.blockNumber, chainId);
      
      return {
        contractAddress,
        deploymentTxHash,
        deploymentBlock: txDetails.blockNumber,
        deploymentTimestamp: deploymentBlock?.timestamp ? 
          new Date(parseInt(deploymentBlock.timestamp) * 1000).toISOString() : null,
        deployer: creationTx.contractCreator,
        hasConstructor: true,
        constructorInputs: constructor.inputs,
        parameters,
        rawConstructorArgs: contractInfo.ConstructorArguments || '',
        decodedParameters,
        gasUsed: txDetails.gasUsed,
        gasPrice: txDetails.gasPrice,
        value: txDetails.value
      };

    } catch (error) {
      throw new Error(`Constructor parameter extraction failed: ${error.message}`);
    }
  }

  private formatValue(value: any, type: string): any {
    if (type.includes('int')) {
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
      // Array type
      return Array.isArray(value) ? value.map(v => this.formatValue(v, type.replace('[]', ''))) : value;
    }
    
    return value;
  }

  private async parseRawConstructorArgs(rawArgs: string, inputs: any[]): Promise<any[]> {
    // Fallback parsing for when ABI decoding fails
    const parameters = [];
    
    try {
      // Simple parsing - divide raw args by expected parameter count
      const argLength = rawArgs.length;
      const paramCount = inputs.length;
      
      if (paramCount === 0) return [];
      
      const bytesPerParam = Math.floor(argLength / paramCount / 2) * 2; // Ensure even number
      
      for (let i = 0; i < paramCount; i++) {
        const start = i * bytesPerParam;
        const end = start + bytesPerParam;
        const rawValue = rawArgs.slice(start, end);
        
        parameters.push({
          name: inputs[i].name || `param${i}`,
          type: inputs[i].type,
          value: this.parseValueByType(rawValue, inputs[i].type),
          rawValue: '0x' + rawValue
        });
      }
    } catch (error) {
      console.error('Raw constructor args parsing failed:', error);
    }
    
    return parameters;
  }

  private parseValueByType(rawValue: string, type: string): any {
    try {
      if (type === 'address') {
        return '0x' + rawValue.slice(-40);
      } else if (type.includes('uint') || type.includes('int')) {
        return BigInt('0x' + rawValue).toString();
      } else if (type === 'bool') {
        return rawValue !== '0000000000000000000000000000000000000000000000000000000000000000';
      } else if (type.includes('bytes')) {
        return '0x' + rawValue;
      }
    } catch (error) {
      console.error('Type parsing error:', error);
    }
    
    return rawValue;
  }

  async getStatus(): Promise<any> {
    try {
      const testResult = await this.etherscan.getContractCreation('0x742d35Cc4Bf426A3C1f5E486D9CBa471F861BC4A', 1);
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
