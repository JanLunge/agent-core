import { McpConnection, type McpServerConfig } from './mcp-client.js';
import type { ToolRegistry } from './registry.js';

/**
 * Sanitize a server name into a safe prefix for tool names.
 * Replaces non-alphanumeric characters with underscores.
 */
function sanitizePrefix(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

/**
 * Connects to MCP servers and registers their tools on the given registry.
 *
 * Each tool is registered with a prefixed name: `mcp_<servername>_<toolname>`
 * to avoid conflicts between servers and with built-in tools.
 *
 * Returns the active connections so callers can close them on shutdown.
 */
export async function loadMcpServers(
  configs: McpServerConfig[],
  registry: ToolRegistry,
): Promise<McpConnection[]> {
  const connections: McpConnection[] = [];

  for (const config of configs) {
    let connection: McpConnection | undefined;
    try {
      connection = new McpConnection(config);
      await connection.connect();

      const tools = await connection.listTools();

      const prefix = sanitizePrefix(config.name);

      for (const tool of tools) {
        const registeredName = `mcp_${prefix}_${sanitizePrefix(tool.name)}`;

        // Capture connection reference for the closure
        const conn = connection;

        registry.register(
          registeredName,
          `[MCP: ${config.name}] ${tool.description ?? tool.name}`,
          tool.inputSchema ?? {},
          async (args) => {
            return conn.callTool(tool.name, args);
          },
        );
      }

      connections.push(connection);
    } catch (err) {
      // Log the error but continue loading other servers
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to load MCP server "${config.name}": ${message}`);

      // Clean up failed connection
      connection?.close();
    }
  }

  return connections;
}
