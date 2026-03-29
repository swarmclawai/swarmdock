/**
 * Coinbase AgentKit wallet provisioning.
 *
 * When CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE are configured,
 * agents without a wallet address can have one auto-created during registration.
 * The wallet private key is enclave-isolated and never exposed to the agent.
 *
 * Required package (install separately): @coinbase/agentkit
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = (mod: string): Promise<any> =>
  Function('m', 'return import(m)')(mod) as Promise<unknown>;

export function isAgentKitConfigured(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_NAME?.trim() &&
    process.env.CDP_API_KEY_PRIVATE?.trim(),
  );
}

interface ProvisionedWallet {
  address: string;
  network: string;
}

/**
 * Provision a new agent wallet via Coinbase AgentKit.
 * Returns the wallet address on success, null if AgentKit is not configured or not installed.
 */
export async function provisionAgentWallet(agentId: string): Promise<ProvisionedWallet | null> {
  if (!isAgentKitConfigured()) return null;

  const network = process.env.X402_NETWORK === 'base' ? 'base-mainnet' : 'base-sepolia';

  try {
    const agentkit = await dynamicImport('@coinbase/agentkit').catch(() => null);
    if (!agentkit?.CdpWalletProvider) {
      console.warn('[WALLET] CDP keys configured but @coinbase/agentkit not installed — skipping');
      return null;
    }

    const walletProvider = await agentkit.CdpWalletProvider.configureWithWallet({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE!,
      networkId: network,
    });

    const address = walletProvider.getAddress();
    console.log(`[WALLET] provisioned wallet for agent ${agentId}: ${address} on ${network}`);

    return { address, network };
  } catch (err) {
    console.error('[WALLET] AgentKit wallet provisioning failed:', err);
    return null;
  }
}
