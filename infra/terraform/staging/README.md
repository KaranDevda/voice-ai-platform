# Staging infrastructure (Terraform)

**Not yet validated or applied.** Written without access to Terraform or an AWS account, so run
`terraform init && terraform validate && terraform plan` and read the plan before applying.

Creates, in ap-south-1: VPC (2 AZ, one NAT), KMS key, RDS PostgreSQL 16 (encrypted, 7-day PITR,
password in Secrets Manager), ElastiCache Redis (TLS + at-rest encryption), private S3 recordings
bucket (SSE-KMS, TLS-only, 180-day expiry), ECR repos, an ECS cluster and log groups.

Not included yet: ECS services, the ALB (wss:// for the voice service), Dockerfiles, IAM task roles,
the GitHub OIDC deploy role, and the Secrets Manager entries for ElevenLabs, Plivo, STT and AskG1 keys.

After the first apply (migration 0000 runs `CREATE EXTENSION vector`): create the
non-owner application DB role and `GRANT EXECUTE ON FUNCTION auth_find_user(text)` to it (see
packages/db/scripts/ci-setup-db.sh for the exact grants).
