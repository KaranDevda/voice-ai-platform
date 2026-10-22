data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = var.name
  cidr = "10.20.0.0/16"
  azs  = local.azs

  public_subnets  = ["10.20.0.0/24", "10.20.1.0/24"]
  private_subnets = ["10.20.10.0/24", "10.20.11.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true # staging only; production should use one per AZ
}

resource "aws_kms_key" "data" {
  description         = "${var.name} data at rest (RDS, S3, Redis)"
  enable_key_rotation = true
}

# Security groups: the app (ECS tasks) is the only thing allowed to reach the data stores.
resource "aws_security_group" "app" {
  name   = "${var.name}-app"
  vpc_id = module.vpc.vpc_id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "${var.name}-db"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_security_group" "redis" {
  name   = "${var.name}-redis"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

# PostgreSQL 16. pgvector ships with RDS; enable it once with `CREATE EXTENSION vector` (migration 0000 does this).
resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "postgres" {
  identifier        = var.name
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = 50
  storage_type      = "gp3"

  db_name  = "voiceai"
  username = "voiceai_owner"
  # RDS creates and rotates the master password in Secrets Manager; it never appears in state or the repo.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.data.arn

  storage_encrypted       = true
  kms_key_id              = aws_kms_key.data.arn
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  publicly_accessible     = false
  backup_retention_period = 7 # SOP: 7-day point-in-time recovery

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.name}-final"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = var.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = var.name
  description                = "BullMQ queues, rate limits, session state"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
}

# Recordings and voice samples: private, KMS-encrypted, TLS-only, served via signed URLs.
resource "aws_s3_bucket" "recordings" {
  bucket_prefix = "${var.name}-recordings-"
}

resource "aws_s3_bucket_public_access_block" "recordings" {
  bucket                  = aws_s3_bucket.recordings.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  rule {
    id     = "expire-recordings"
    status = "Enabled"
    filter {}
    expiration {
      days = var.recording_retention_days
    }
  }
}

data "aws_iam_policy_document" "recordings_tls_only" {
  statement {
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.recordings.arn, "${aws_s3_bucket.recordings.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  policy = data.aws_iam_policy_document.recordings_tls_only.json
}

# Container registries and the ECS cluster. Services and the load balancer (the voice service needs
# wss:// with sticky, long-lived connections) are added once the apps have Dockerfiles.
resource "aws_ecr_repository" "app" {
  for_each             = toset(["web", "voice", "worker"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["web", "voice", "worker"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = 30
}
