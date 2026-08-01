variable "name" {
  description = "Name prefix for all resources."
  type        = string
  default     = "careloop"
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the bridge."
  type        = string
  default     = "t3.small"
}

variable "public_host" {
  description = "Public hostname Twilio connects to. Its DNS A record must point at the Elastic IP before Caddy can issue a certificate."
  type        = string
}

variable "repo_url" {
  description = "Git URL the instance clones the bridge from."
  type        = string
}

variable "env_parameter_name" {
  description = "SSM SecureString parameter holding the bridge's runtime environment."
  type        = string
  default     = "/careloop/bridge-env"
}
