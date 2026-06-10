function backendPort(): string {
  const configured = import.meta.env.VITE_DESIGNER_MCP_PORT as string | undefined;
  if (configured && configured.trim() !== "") return configured;
  if (typeof window !== "undefined" && window.location.port) return window.location.port;
  return "5179";
}

function backendHostname(): string {
  return typeof window !== "undefined" ? window.location.hostname : "localhost";
}

export function backendOrigin(): string {
  return `http://${backendHostname()}:${backendPort()}`;
}

export function backendWebSocketUrl(): string {
  return `ws://${backendHostname()}:${backendPort()}`;
}
