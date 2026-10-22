terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # Create this bucket and a lock table by hand once, then uncomment.
  # backend "s3" {
  #   bucket         = "voiceai-tfstate-<account-id>"
  #   key            = "staging/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "voiceai-tflock"
  #   encrypt        = true
  # }
}

# SOP: all storage in ap-south-1 (Mumbai).
provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = { project = "voice-ai-platform", env = "staging", managed_by = "terraform" }
  }
}
