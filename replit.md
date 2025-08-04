# Overview

This is a sophisticated blockchain security analysis platform that combines a React frontend with an Express.js backend to analyze smart contracts for vulnerabilities. The system uses the Model Context Protocol (MCP) architecture to orchestrate six specialized analysis tools that work together to identify potential exploits in smart contracts. The platform provides real-time monitoring, automated testing, and comprehensive reporting of security findings across multiple blockchain networks.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client uses React with TypeScript, built with Vite for development and production bundling. The UI is constructed with shadcn/ui components and Tailwind CSS for styling, following a "new-york" design system. State management is handled through TanStack Query for server state and React hooks for local state. The routing system uses Wouter for lightweight client-side navigation.

## Backend Architecture
The server runs on Express.js with TypeScript support, following a modular architecture with clear separation between routes, services, and data access layers. The MCP (Model Context Protocol) server manages six specialized analysis tools that communicate via WebSocket connections. The system supports both REST API endpoints for standard operations and real-time communication through Server-Sent Events (SSE) and WebSocket connections.

## Database Layer
The application uses Drizzle ORM with PostgreSQL as the primary database, specifically configured for Neon serverless database hosting. The schema includes tables for users, MCP sessions, tool executions, exploit discoveries, performance metrics, and API usage tracking. Database migrations are managed through Drizzle Kit with schemas defined in shared TypeScript files.

## Analysis Tools Architecture
Six specialized MCP tools handle different aspects of contract analysis:
- **Source Code Fetcher**: Retrieves verified source code from Etherscan with proxy detection
- **Constructor Parameters**: Extracts and decodes deployment parameters
- **State Reader**: Performs batch RPC calls to read contract state
- **Code Sanitizer**: Cleans and processes Solidity code while preserving vulnerability patterns
- **Concrete Execution**: Uses Forge for exploit simulation and testing
- **Revenue Normalizer**: Calculates financial impact using multi-DEX price aggregation

## Real-time Communication
The system implements multiple real-time communication channels:
- WebSocket connections for MCP tool communication
- Server-Sent Events for activity feeds and status updates
- React hooks for managing WebSocket and SSE connections with automatic reconnection

## Blockchain Integration
Multi-chain support is provided through ethers.js with configured providers for Ethereum, BSC, Polygon, Arbitrum, Optimism, and Base networks. The system integrates with Etherscan APIs for source code retrieval and uses Chainlink price feeds for accurate token valuation.

# External Dependencies

## Blockchain Services
- **Etherscan API**: Contract source code verification, transaction history, and constructor parameter extraction
- **RPC Providers**: Multiple blockchain network providers including Alchemy for Ethereum, with fallbacks to public endpoints
- **Chainlink Price Feeds**: On-chain price data for accurate value-at-risk calculations across different networks

## Database Infrastructure  
- **Neon Database**: Serverless PostgreSQL hosting with connection pooling via `@neondatabase/serverless`
- **Drizzle ORM**: Type-safe database queries and schema management with PostgreSQL dialect support

## Development Tools
- **Forge (Foundry)**: Ethereum development framework for concrete exploit execution and testing (optional dependency)
- **Solidity Parser**: `@solidity-parser/parser` for AST generation and code analysis
- **Replit Integration**: Development environment support with cartographer plugin and runtime error overlays

## Third-party Libraries
- **UI Components**: Extensive Radix UI component library for accessible, unstyled components
- **Styling**: Tailwind CSS with shadcn/ui design system and CVA for component variants
- **HTTP Client**: Native fetch API with TanStack Query for caching and state management
- **WebSocket**: Native WebSocket API with custom hooks for connection management