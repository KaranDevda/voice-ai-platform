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
