// Minimal JSON-RPC client. The gateway (sidecar) and ethrex both speak it; errors keep the node's code and message.
export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
  }
}

export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)),
    });
  } catch (e) {
    throw new RpcError(-1, `RPC unreachable: ${url}: ${(e as Error).message}`);
  }
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
  return body.result as T;
}
