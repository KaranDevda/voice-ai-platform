variable "name" {
  type    = string
  default = "voiceai-staging"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "recording_retention_days" {
  description = "Matches the SOP default for recordings; the app's nightly purge job also enforces per-org settings."
  type        = number
  default     = 180
}

variable "domain_name" {
  description = "Public host name (for example staging.example.com), once the CEO picks one. Empty: the load balancer's own address is used."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate for the domain (same region). Empty: the load balancer serves plain HTTP, which is only for a first smoke test with no real data."
  type        = string
  default     = ""
}

variable "askg1_base_url" {
  description = "Where AskG1 answers. It is on a private network (Tailscale) today, which AWS cannot reach; ask the AskG1 team for a reachable address."
  type        = string
  default     = ""
}

variable "services_desired" {
  description = "How many copies of each service to run. 0 until the first images are pushed and the secrets are filled in."
  type        = number
  default     = 0
}

variable "github_repo" {
  description = "Repository allowed to deploy (owner/name)."
  type        = string
  default     = "KaranDevda/voice-ai-platform"
}

variable "create_github_oidc_provider" {
  description = "Set false if this AWS account already has the GitHub OIDC provider."
  type        = bool
  default     = true
}
