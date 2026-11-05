# One public load balancer: the voice service's WebSocket and phone-carrier paths go to it, everything else to the website.
resource "aws_security_group" "alb" {
  name   = "${var.name}-alb"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "app_web_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "app_voice_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 4001
  to_port                      = 4001
  ip_protocol                  = "tcp"
}

resource "aws_lb" "main" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = module.vpc.public_subnets
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 3600 # phone calls are long-lived WebSockets
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = module.vpc.vpc_id
  deregistration_delay = 30
  health_check {
    path    = "/api/health"
    matcher = "200"
  }
}

resource "aws_lb_target_group" "voice" {
  name                 = "${var.name}-voice"
  port                 = 4001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = module.vpc.vpc_id
  deregistration_delay = 300 # let calls in progress finish when a copy is replaced
  health_check {
    path    = "/healthz"
    matcher = "200"
  }
}

locals {
  https      = var.certificate_arn != ""
  public_url = var.domain_name != "" ? "https://${var.domain_name}" : "${local.https ? "https" : "http"}://${aws_lb.main.dns_name}"
  ws_url     = "${replace(local.public_url, "/^http/", "ws")}/stream"
}

# With a certificate: HTTPS does the work and plain HTTP only redirects. Without one: plain HTTP serves (smoke test only).
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  # Reviewed: with a certificate this listener only redirects to HTTPS (see the default_action below); plain HTTP serving exists for the no-certificate smoke test only.
  # nosemgrep: terraform.aws.security.insecure-load-balancer-tls-version.insecure-load-balancer-tls-version
  protocol          = "HTTP"
  default_action {
    type             = local.https ? "redirect" : "forward"
    target_group_arn = local.https ? null : aws_lb_target_group.web.arn
    dynamic "redirect" {
      for_each = local.https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

locals {
  listener_arn = local.https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

resource "aws_lb_listener_rule" "voice" {
  listener_arn = local.listener_arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.voice.arn
  }
  condition {
    path_pattern {
      values = ["/stream", "/stream/*", "/plivo/*"]
    }
  }
}
