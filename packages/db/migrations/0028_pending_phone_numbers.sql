-- Carrier purchases that need KYC or address documents must not be assignable yet.
ALTER TABLE "phone_numbers" DROP CONSTRAINT "phone_numbers_status_chk";
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_status_chk" CHECK ("status" IN ('available','pending','assigned','released'));
