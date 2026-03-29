import type { Context } from 'hono';
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
  type RouteConfig,
  type HTTPRequestContext,
} from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';

const NETWORK_IDS: Record<string, `${string}:${string}`> = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

let resourceServerPromise: Promise<x402ResourceServer> | null = null;

class HonoRequestAdapter implements HTTPAdapter {
  constructor(private readonly context: Context) {}

  getHeader(name: string): string | undefined {
    return this.context.req.header(name);
  }

  getMethod(): string {
    return this.context.req.method;
  }

  getPath(): string {
    return this.context.req.path;
  }

  getUrl(): string {
    return this.context.req.url;
  }

  getAcceptHeader(): string {
    return this.context.req.header('accept') ?? 'application/json';
  }

  getUserAgent(): string {
    return this.context.req.header('user-agent') ?? 'unknown';
  }

  getQueryParams(): Record<string, string | string[]> {
    return this.context.req.queries();
  }
}

export function isX402Enabled(): boolean {
  return Boolean(process.env.PLATFORM_WALLET_ADDRESS?.trim());
}

export function getX402Network(): `${string}:${string}` {
  return NETWORK_IDS[process.env.X402_NETWORK ?? 'base-sepolia'] ?? NETWORK_IDS['base-sepolia'];
}

export function getX402FacilitatorUrl(): string {
  return process.env.X402_FACILITATOR_URL
    ?? (getX402Network() === 'eip155:8453'
      ? 'https://api.cdp.coinbase.com/platform/v2/x402'
      : 'https://x402.org/facilitator');
}

export function microUsdcToUsdPrice(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `$${whole}.${fraction}` : `$${whole}`;
}

async function getResourceServer() {
  if (!resourceServerPromise) {
    resourceServerPromise = (async () => {
      const facilitator = new HTTPFacilitatorClient({
        url: getX402FacilitatorUrl(),
      });
      const server = new x402ResourceServer(facilitator);
      registerExactEvmScheme(server, { networks: [getX402Network()] });
      return server;
    })();
  }

  return resourceServerPromise;
}

function createResponseFromInstructions(instructions: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}) {
  const body = instructions.body === undefined
    ? null
    : typeof instructions.body === 'string'
      ? instructions.body
      : JSON.stringify(instructions.body);

  return new Response(body, {
    status: instructions.status,
    headers: instructions.headers,
  });
}

export type PendingX402Settlement = {
  settle: (responseBody?: unknown) => Promise<
    | { ok: true; transaction: string; network: string; payer?: string; headers: Record<string, string> }
    | { ok: false; response: Response }
  >;
};

export async function requireX402Payment(
  context: Context,
  routeConfig: RouteConfig,
): Promise<{ pendingSettlement: PendingX402Settlement | null; response?: Response }> {
  if (!isX402Enabled()) {
    return { pendingSettlement: null };
  }

  const httpServer = new x402HTTPResourceServer(await getResourceServer(), routeConfig);
  await httpServer.initialize();

  const request: HTTPRequestContext = {
    adapter: new HonoRequestAdapter(context),
    path: context.req.path,
    method: context.req.method,
    paymentHeader: context.req.header('PAYMENT-SIGNATURE') ?? context.req.header('X-PAYMENT'),
    routePattern: context.req.path,
  };

  const result = await httpServer.processHTTPRequest(request, {
    appName: 'SwarmDock',
    testnet: getX402Network() !== NETWORK_IDS.base,
  });

  if (result.type === 'payment-error') {
    return { pendingSettlement: null, response: createResponseFromInstructions(result.response) };
  }

  if (result.type === 'no-payment-required') {
    return { pendingSettlement: null };
  }

  return {
    pendingSettlement: {
      async settle(responseBody) {
        const settlement = await httpServer.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          responseBody === undefined
            ? { request }
            : {
                request,
                responseBody: Buffer.from(JSON.stringify(responseBody)),
              },
        );

        if (!settlement.success) {
          return { ok: false, response: createResponseFromInstructions(settlement.response) };
        }

        return {
          ok: true,
          transaction: settlement.transaction,
          network: settlement.network,
          payer: settlement.payer,
          headers: settlement.headers,
        };
      },
    },
  };
}
