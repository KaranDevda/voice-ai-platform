# The three services and the one-off database job. Images are pushed by the deploy workflow (tagged with the commit), which also
# registers new task definition revisions; Terraform only creates the first one, so it ignores later changes to the container.
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/${var.name}/migrate"
  retention_in_days = 30
}

locals {
  runtime_secret   = aws_secretsmanager_secret.runtime.arn
  providers_secret = aws_secretsmanager_secret.providers.arn
  askg1_env        = var.askg1_base_url == "" ? [] : [{ name = "ASKG1_BASE_URL", value = var.askg1_base_url }]
  tag              = "bootstrap" # replaced by the deploy workflow

  containers = {
    web = {
      cpu = 512, memory = 1024, port = 3000, role = aws_iam_role.web.arn
      env = concat([
        { name = "PORT", value = "3000" },
        { name = "RECORDINGS_BUCKET", value = aws_s3_bucket.recordings.bucket },
        { name = "RECORDINGS_REGION", value = data.aws_region.current.name },
        { name = "VOICE_WS_URL", value = local.ws_url },
      ], local.askg1_env)
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${local.runtime_secret}:DATABASE_URL::" },
        { name = "SESSION_SECRET", valueFrom = "${local.runtime_secret}:SESSION_SECRET::" },
        { name = "VOICE_TOKEN_SECRET", valueFrom = "${local.runtime_secret}:VOICE_TOKEN_SECRET::" },
        { name = "VOICE_FILE_SECRET", valueFrom = "${local.runtime_secret}:VOICE_FILE_SECRET::" },
        { name = "MFA_ENCRYPTION_KEY", valueFrom = "${local.runtime_secret}:MFA_ENCRYPTION_KEY::" },
        { name = "DEEPGRAM_API_KEY", valueFrom = "${local.providers_secret}:DEEPGRAM_API_KEY::" },
        { name = "ELEVENLABS_API_KEY", valueFrom = "${local.providers_secret}:ELEVENLABS_API_KEY::" },
        { name = "ASKG1_API_KEY", valueFrom = "${local.providers_secret}:ASKG1_API_KEY::" },
      ]
    }
    voice = {
      cpu = 1024, memory = 2048, port = 4001, role = null
      env = concat([
        { name = "PORT", value = "4001" },
        { name = "WEB_ORIGIN", value = local.public_url },
        { name = "WEB_BASE_URL", value = local.public_url },
        { name = "PUBLIC_BASE_URL", value = local.public_url },
        { name = "STT_PROVIDER", value = "deepgram" },
        { name = "MAX_SESSIONS", value = "20" },
      ], local.askg1_env)
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${local.runtime_secret}:DATABASE_URL::" },
        { name = "SESSION_SECRET", valueFrom = "${local.runtime_secret}:SESSION_SECRET::" },
        { name = "VOICE_TOKEN_SECRET", valueFrom = "${local.runtime_secret}:VOICE_TOKEN_SECRET::" },
        { name = "VOICE_FILE_SECRET", valueFrom = "${local.runtime_secret}:VOICE_FILE_SECRET::" },
        { name = "DEEPGRAM_API_KEY", valueFrom = "${local.providers_secret}:DEEPGRAM_API_KEY::" },
        { name = "ELEVENLABS_API_KEY", valueFrom = "${local.providers_secret}:ELEVENLABS_API_KEY::" },
        { name = "ASKG1_API_KEY", valueFrom = "${local.providers_secret}:ASKG1_API_KEY::" },
        { name = "PLIVO_AUTH_ID", valueFrom = "${local.providers_secret}:PLIVO_AUTH_ID::" },
        { name = "PLIVO_AUTH_TOKEN", valueFrom = "${local.providers_secret}:PLIVO_AUTH_TOKEN::" },
      ]
    }
    worker = {
      cpu = 256, memory = 512, port = null, role = aws_iam_role.worker.arn
      env = concat([
        { name = "RECORDINGS_BUCKET", value = aws_s3_bucket.recordings.bucket },
        { name = "RECORDINGS_REGION", value = data.aws_region.current.name },
      ], local.askg1_env)
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${local.runtime_secret}:DATABASE_URL::" },
        { name = "ASKG1_API_KEY", valueFrom = "${local.providers_secret}:ASKG1_API_KEY::" },
      ]
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.containers
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.role
  container_definitions = jsonencode([{
    name         = each.key
    image        = "${aws_ecr_repository.app[each.key].repository_url}:${local.tag}"
    essential    = true
    environment  = each.value.env
    secrets      = each.value.secrets
    portMappings = each.value.port == null ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = { "awslogs-group" = aws_cloudwatch_log_group.app[each.key].name, "awslogs-region" = data.aws_region.current.name, "awslogs-stream-prefix" = each.key }
    }
    readonlyRootFilesystem = false # Next.js writes its cache under the app folder
  }])
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# One-off: applies the migrations and creates the application database role. Run with `aws ecs run-task` (see the README).
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.app["worker"].repository_url}:${local.tag}"
    essential = true
    command   = ["sh", "-c", "cd packages/db && pnpm provision"]
    environment = [
      { name = "DB_HOST", value = aws_db_instance.postgres.endpoint },
      { name = "DB_NAME", value = "voiceai" },
    ]
    secrets = [
      { name = "DB_USER", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
      { name = "APP_DB_PASSWORD", valueFrom = "${local.runtime_secret}:APP_DB_PASSWORD::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options   = { "awslogs-group" = aws_cloudwatch_log_group.migrate.name, "awslogs-region" = data.aws_region.current.name, "awslogs-stream-prefix" = "migrate" }
    }
  }])
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app["web"].arn
  desired_count   = var.services_desired
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.http, aws_lb_listener.https]
}

resource "aws_ecs_service" "voice" {
  name            = "voice"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app["voice"].arn
  desired_count   = var.services_desired
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.voice.arn
    container_name   = "voice"
    container_port   = 4001
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener_rule.voice]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app["worker"].arn
  desired_count   = var.services_desired
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.app.id]
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
}
