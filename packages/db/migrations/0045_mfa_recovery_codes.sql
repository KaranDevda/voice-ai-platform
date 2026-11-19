-- One-time 2FA recovery codes. Only SHA-256 hashes are kept, as a JSON array; a used code is removed from the array.
ALTER TABLE users ADD COLUMN mfa_recovery_codes text;
