# Staging infrastructure (Terraform)

**Checked with `terraform validate` only.** Never planned or applied: it was written without an AWS account. The Docker images
have not been built either. Run `terraform plan` and read it before applying; expect to fix small things on the first run.

Creates, in ap-south-1: VPC (2 AZ, one NAT), KMS key, RDS PostgreSQL 16 (encrypted, 7-day PITR), Redis (TLS + at rest),
private S3 recordings bucket (SSE-KMS, TLS-only, 180-day expiry), ECR repos, ECS cluster with three Fargate services
(web, voice, worker) and a one-off database job, a public load balancer (voice paths `/stream` and `/plivo/*` to the voice
service, the rest to the website), IAM roles (task roles only for S3; a GitHub deploy role without stored keys), and
Secrets Manager entries (`/runtime` generated here, `/providers` filled by hand).

Costs money while it exists (NAT gateway, RDS, Redis, load balancer, Fargate): get the CEO's approval before `apply`.

## Runbook
1. **Tools and login:** `brew install awscli`, `aws configure sso`, `aws sts get-caller-identity` shows the right account.
2. **State bucket (once, by hand):** a private, versioned, encrypted S3 bucket plus a DynamoDB lock table, then uncomment `backend "s3"` in `versions.tf`. State holds the generated database password and secrets, so keep it private.
3. **Plan:** `terraform init && terraform plan -out=staging.plan`. Variables (`-var` or `terraform.tfvars`): `domain_name` and `certificate_arn` once the CEO picks a domain (without them the site is plain HTTP, smoke test only, no real data), `askg1_base_url`, `create_github_oidc_provider=false` if the account already has one.
4. **Apply:** `terraform apply staging.plan` (RDS takes 15-25 minutes). Services start at 0 copies on purpose.
5. **Secrets:** put the provider keys in the `providers` secret as JSON with exactly: `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ASKG1_API_KEY`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN` (a placeholder for any not used yet), e.g. `aws secretsmanager put-secret-value --secret-id voiceai-staging/providers --secret-string file://keys.json`. Never commit that file.
6. **GitHub:** set the repository variable `AWS_DEPLOY_ROLE_ARN` to `terraform output deploy_role_arn`.
7. **First deploy:** run the "Deploy staging" workflow with `migrate` ticked (builds and pushes the images, runs migrations and creates the app database role), then set `services_desired = 1` and `terraform apply` to start the services. Later deploys: run the workflow again.
8. **Check:** open `terraform output public_url`; `/api/health` and `/healthz` answer.

## Known gaps
- AskG1 is on a Tailscale address that AWS cannot reach: set `askg1_base_url` to something reachable (AskG1 team).
- Local speech (Whisper, Kokoro, Pocket TTS, the voice converter) is not deployed. The cloud setup uses Deepgram and ElevenLabs; that path is untested here with this configuration.
- Redis is created but nothing uses it yet. The database connection skips certificate checking (`sslmode=no-verify`) until the RDS CA bundle is added.
- No WAF and no rate limit shared between copies; no alarms or dashboards yet; the load balancer is HTTP-only until a certificate is given.
