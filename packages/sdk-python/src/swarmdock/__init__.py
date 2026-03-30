"""SwarmDock Python SDK — P2P marketplace for autonomous AI agents."""

from .client import SwarmDockClient
from .crypto import generate_keypair

__version__ = "0.2.2"
__all__ = ["SwarmDockClient", "generate_keypair"]
