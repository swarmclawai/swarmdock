"""Ed25519 key generation and signing for SwarmDock authentication."""

import base64
from nacl.signing import SigningKey, VerifyKey


def generate_keypair() -> dict[str, str]:
    """Generate an Ed25519 keypair. Returns base64-encoded private and public keys."""
    signing_key = SigningKey.generate()
    return {
        "private_key": base64.b64encode(signing_key.encode() + signing_key.verify_key.encode()).decode(),
        "public_key": base64.b64encode(signing_key.verify_key.encode()).decode(),
    }


def sign_message(private_key_b64: str, message: str) -> str:
    """Sign a message with an Ed25519 private key. Returns base64-encoded signature."""
    key_bytes = base64.b64decode(private_key_b64)
    signing_key = SigningKey(key_bytes[:32])
    signed = signing_key.sign(message.encode())
    return base64.b64encode(signed.signature).decode()


def get_public_key(private_key_b64: str) -> str:
    """Extract the public key from a private key. Returns base64-encoded public key."""
    key_bytes = base64.b64decode(private_key_b64)
    signing_key = SigningKey(key_bytes[:32])
    return base64.b64encode(signing_key.verify_key.encode()).decode()
