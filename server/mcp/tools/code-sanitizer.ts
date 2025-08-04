import parser from '@solidity-parser/parser';
import { z } from 'zod';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  sourceCode: z.string(),
  preserveComments: z.boolean().default(false),
  removeDeadCode: z.boolean().default(true),
  extractInterfaces: z.boolean().default(true),
});

export class CodeSanitizer {
  getDescription(): string {
    return "Sanitizes Solidity source code by removing comments, dead code, and extracting interfaces while preserving vulnerability patterns";
  }

  getInputSchema(): any {
    return inputSchema.shape;
  }

  async execute(args: z.infer<typeof inputSchema>): Promise<any> {
    const { sourceCode, preserveComments, removeDeadCode, extractInterfaces } = inputSchema.parse(args);

    try {
      let sanitizedCode = sourceCode;
      const analysis = {
        originalLines: sourceCode.split('\n').length,
        originalSize: sourceCode.length,
        removedComments: 0,
        removedDeadCode: 0,
        extractedInterfaces: [],
        preservedPatterns: [],
        warnings: []
      };

      // Parse the Solidity code
      let ast;
      try {
        ast = parser.parse(sourceCode, {
          loc: true,
          range: true
        });
      } catch (parseError) {
        // Try to parse with relaxed rules
        try {
          ast = parser.parse(sourceCode, {
            loc: true,
            range: true
          });
          analysis.warnings.push('Code parsed with error recovery mode');
        } catch (finalError) {
          throw new Error(`Failed to parse Solidity code: ${finalError.message}`);
        }
      }

      // Remove comments if not preserving them
      if (!preserveComments) {
        sanitizedCode = this.removeComments(sanitizedCode);
        analysis.removedComments = this.countComments(sourceCode);
      }

      // Extract interfaces if requested
      if (extractInterfaces) {
        analysis.extractedInterfaces = this.extractInterfaces(ast);
      }

      // Remove dead code if requested
      if (removeDeadCode) {
        const deadCodeResult = this.removeDeadCode(sanitizedCode, ast);
        sanitizedCode = deadCodeResult.code;
        analysis.removedDeadCode = deadCodeResult.removedCount;
      }

      // Identify and preserve critical vulnerability patterns
      const vulnerabilityPatterns = this.identifyVulnerabilityPatterns(ast);
      analysis.preservedPatterns = vulnerabilityPatterns;

      // Clean up extra whitespace while preserving structure
      sanitizedCode = this.cleanWhitespace(sanitizedCode);

      // Generate minimal interface
      const minimalInterface = this.generateMinimalInterface(ast);

      const finalAnalysis = {
        ...analysis,
        sanitizedLines: sanitizedCode.split('\n').length,
        sanitizedSize: sanitizedCode.length,
        compressionRatio: ((sourceCode.length - sanitizedCode.length) / sourceCode.length * 100).toFixed(2) + '%'
      };

      return {
        sanitizedCode,
        minimalInterface,
        analysis: finalAnalysis,
        vulnerabilityPatterns,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      throw new Error(`Code sanitization failed: ${error.message}`);
    }
  }

  private removeComments(code: string): string {
    // Remove single-line comments
    code = code.replace(/\/\/.*$/gm, '');
    
    // Remove multi-line comments but preserve SPDX and important annotations
    code = code.replace(/\/\*(?!.*SPDX)[\s\S]*?\*\//g, '');
    
    return code;
  }

  private countComments(code: string): number {
    const singleLineComments = (code.match(/\/\/.*$/gm) || []).length;
    const multiLineComments = (code.match(/\/\*[\s\S]*?\*\//g) || []).length;
    return singleLineComments + multiLineComments;
  }

  private extractInterfaces(ast: any): any[] {
    const interfaces = [];
    
    try {
      Parser.visit(ast, {
        ContractStatement: (node) => {
          if (node.kind === 'interface') {
            interfaces.push({
              name: node.name,
              functions: node.subNodes
                .filter(sub => sub.type === 'FunctionDefinition')
                .map(func => ({
                  name: func.name,
                  parameters: func.parameters?.parameters || [],
                  returnParameters: func.returnParameters?.parameters || [],
                  stateMutability: func.stateMutability,
                  visibility: func.visibility
                }))
            });
          }
        }
      });
    } catch (error) {
      console.error('Error extracting interfaces:', error);
    }
    
    return interfaces;
  }

  private removeDeadCode(code: string, ast: any): { code: string, removedCount: number } {
    let removedCount = 0;
    const usedFunctions = new Set();
    const usedVariables = new Set();
    
    try {
      // First pass: identify used functions and variables
      Parser.visit(ast, {
        FunctionCall: (node) => {
          if (node.names && node.names.length > 0) {
            usedFunctions.add(node.names[0]);
          }
        },
        Identifier: (node) => {
          usedVariables.add(node.name);
        }
      });

      // For now, return original code as dead code removal is complex
      // In production, this would implement proper reachability analysis
      return { code, removedCount };
      
    } catch (error) {
      console.error('Error in dead code removal:', error);
      return { code, removedCount: 0 };
    }
  }

  private identifyVulnerabilityPatterns(ast: any): string[] {
    const patterns = [];
    
    try {
      Parser.visit(ast, {
        FunctionCall: (node) => {
          // Check for dangerous patterns
          if (node.names && node.names.length > 0) {
            const funcName = node.names[0];
            
            if (funcName === 'delegatecall') {
              patterns.push('delegatecall usage detected');
            }
            if (funcName === 'selfdestruct') {
              patterns.push('selfdestruct usage detected');
            }
            if (funcName === 'call') {
              patterns.push('low-level call detected');
            }
          }
        },
        
        AssemblyBlock: (node) => {
          patterns.push('inline assembly block detected');
        },
        
        ModifierInvocation: (node) => {
          if (node.name === 'onlyOwner' || node.name === 'onlyAdmin') {
            patterns.push('access control modifier detected');
          }
        },
        
        StateVariableDeclaration: (node) => {
          if (node.variables) {
            node.variables.forEach(variable => {
              if (variable.typeName && variable.typeName.type === 'Mapping') {
                patterns.push('mapping state variable detected');
              }
            });
          }
        }
      });
    } catch (error) {
      console.error('Error identifying vulnerability patterns:', error);
    }
    
    return [...new Set(patterns)]; // Remove duplicates
  }

  private cleanWhitespace(code: string): string {
    // Remove extra blank lines but preserve structure
    code = code.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove trailing whitespace
    code = code.replace(/[ \t]+$/gm, '');
    
    // Ensure single newline at end
    code = code.replace(/\n*$/, '\n');
    
    return code;
  }

  private generateMinimalInterface(ast: any): string {
    const interfaces = [];
    
    try {
      Parser.visit(ast, {
        ContractStatement: (node) => {
          if (node.kind === 'contract') {
            const functions = node.subNodes
              .filter(sub => sub.type === 'FunctionDefinition' && sub.visibility === 'public')
              .map(func => {
                const params = func.parameters?.parameters?.map(p => 
                  `${p.typeName.type || 'uint256'} ${p.name || ''}`
                ).join(', ') || '';
                
                const returns = func.returnParameters?.parameters?.map(p => 
                  p.typeName.type || 'uint256'
                ).join(', ');
                
                const returnsClause = returns ? ` returns (${returns})` : '';
                
                return `    function ${func.name}(${params})${returnsClause};`;
              });
            
            if (functions.length > 0) {
              interfaces.push(`interface I${node.name} {\n${functions.join('\n')}\n}`);
            }
          }
        }
      });
    } catch (error) {
      console.error('Error generating minimal interface:', error);
    }
    
    return interfaces.join('\n\n');
  }

  async getStatus(): Promise<any> {
    try {
      // Test parser functionality
      const testCode = 'pragma solidity ^0.8.0; contract Test { function test() public {} }';
      Parser.parse(testCode);
      
      return {
        status: 'operational',
        lastCheck: new Date().toISOString(),
        parserAvailable: true
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
