/**
 * Coinbase AgentKit wallet provisioning with persistence.
 *
 * When CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE are configured,
 * agents without a wallet address can have one auto-created during registration.
 * Wallet data is encrypted and stored in the agent_wallets table for recovery.
 *
 * Required packages (install separately): @coinbase/agentkit
 * Required env: CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE, WALLET_ENCRYPTION_KEY
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { db } from '../db/client.js';
import { agentWallets } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = (mod: string): Promise<any> =>
  Function('m', 'return import(m)')(mod) as Promise<unknown>;

export function isAgentKitConfigured(): boolean {
  return Boolean(
    process.env.CDP_API_KEY_NAME?.trim() &&
    process.env.CDP_API_KEY_PRIVATE?.trim(),
  );
}

type WalletResult =
  | { ok: true; address: string; network: string }
  | { ok: false; reason: 'not_configured' | 'not_installed' | 'provision_failed' | 'no_encryption_key'; error?: unknown };

function getEncryptionKey(): Buffer | null {
  const keyEnv = process.env.WALLET_ENCRYPTION_KEY;
  if (!keyEnv) return null;
  return scryptSync(keyEnv, 'swarmdock-wallet-salt', 32);
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext: string, key: Buffer): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Get an existing wallet or provision a new one for an agent.
 * Wallet data is encrypted and persisted in the database.
 */
export async function getOrProvisionWallet(agentId: string): Promise<WalletResult> {
  if (!isAgentKitConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    return { ok: false, reason: 'no_encryption_key' };
  }

  // Check for existing wallet
  const [existing] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.agentId, agentId))
    .limit(1);

  if (existing) {
    return { ok: true, address: existing.address, network: existing.network };
  }

  // Provision new wallet
  const network = process.env.X402_NETWORK === 'base' ? 'base-mainnet' : 'base-sepolia';

  const agentkit = await dynamicImport('@coinbase/agentkit').catch(() => null);
  if (!agentkit?.CdpWalletProvider) {
    console.warn('[WALLET] CDP keys configured but @coinbase/agentkit not installed');
    return { ok: false, reason: 'not_installed' };
  }

  try {
    const walletProvider = await agentkit.CdpWalletProvider.configureWithWallet({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE!,
      networkId: network,
    });

    const address = walletProvider.getAddress();
    const walletData = JSON.stringify(await walletProvider.exportWallet());
    const encryptedData = encrypt(walletData, encryptionKey);

    await db.insert(agentWallets).values({
      agentId,
      address,
      network,
      encryptedWalletData: encryptedData,
    });

    console.log(`[WALLET] provisioned wallet for agent ${agentId}: ${address} on ${network}`);
    return { ok: true, address, network };
  } catch (err) {
    console.error('[WALLET] AgentKit wallet provisioning failed:', err);
    return { ok: false, reason: 'provision_failed', error: err };
  }
}

/**
 * Restore a previously provisioned wallet for an agent.
 * Returns null if no wallet exists or AgentKit is not available.
 */
export async function restoreWallet(agentId: string): Promise<WalletResult> {
  if (!isAgentKitConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) {
    return { ok: false, reason: 'no_encryption_key' };
  }

  const [existing] = await db
    .select()
    .from(agentWallets)
    .where(eq(agentWallets.agentId, agentId))
    .limit(1);

  if (!existing) {
    return { ok: false, reason: 'not_configured' };
  }

  return { ok: true, address: existing.address, network: existing.network };
}

/**
 * Legacy wrapper for backward compatibility.
 * Returns { address, network } on success, null otherwise.
 */
export async function provisionAgentWallet(agentId: string): Promise<{ address: string; network: string } | null> {
  const result = await getOrProvisionWallet(agentId);
  if (result.ok) return { address: result.address, network: result.network };
  return null;
}
