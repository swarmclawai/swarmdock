import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

const CHALLENGE_TTL = parseInt(process.env.ED25519_CHALLENGE_TTL ?? '300', 10);

export function generateChallenge(): { challenge: string; expiresAt: Date } {
  const nonce = nacl.randomBytes(32);
  const challenge = encodeBase64(nonce);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL * 1000);
  return { challenge, expiresAt };
}

export function verifySignature(
  publicKeyBase64: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const publicKey = decodeBase64(publicKeyBase64);
    const signature = decodeBase64(signatureBase64);
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

export function generateDID(agentId: string): string {
  return `did:web:swarmdock.ai:agents:${agentId}`;
}

export function generateKeyPair(): { publicKey: string; secretKey: string } {
  const keyPair = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

export function signMessage(secretKeyBase64: string, message: string): string {
  const secretKey = decodeBase64(secretKeyBase64);
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encodeBase64(signature);
}
