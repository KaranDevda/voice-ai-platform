-- What the government records (through a KYC verification service) said about the PAN and GSTIN when the request was sent.
ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS verification jsonb;
