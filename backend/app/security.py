import hmac
import secrets
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str, candidate: str) -> tuple[bool, str | None]:
    """Verify Argon2 hashes and transparently upgrade legacy plaintext passwords."""
    if stored.startswith("$argon2"):
        try:
            valid = _hasher.verify(stored, candidate)
            return valid, _hasher.hash(candidate) if valid and _hasher.check_needs_rehash(stored) else None
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False, None
    valid = hmac.compare_digest(stored, candidate)
    return valid, hash_password(candidate) if valid else None


def session_token() -> str:
    return str(uuid.uuid4())


def csrf_token() -> str:
    return secrets.token_urlsafe(32)
