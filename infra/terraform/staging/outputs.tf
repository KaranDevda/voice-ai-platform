output "db_endpoint" { value = aws_db_instance.postgres.endpoint }
output "db_master_secret_arn" { value = aws_db_instance.postgres.master_user_secret[0].secret_arn }
output "redis_endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "recordings_bucket" { value = aws_s3_bucket.recordings.bucket }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.app : k => r.repository_url } }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "public_url" { value = local.public_url }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "providers_secret" { value = aws_secretsmanager_secret.providers.name }
output "private_subnets" { value = module.vpc.private_subnets }
output "app_security_group" { value = aws_security_group.app.id }
