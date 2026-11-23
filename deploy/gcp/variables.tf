variable "project_id" {
  description = "GCP project to deploy into."
  type        = string
}

variable "convex_site" {
  description = "Convex HTTP actions URL, the source of truth (e.g. https://tame-crow-881.convex.site)."
  type        = string
}

variable "image" {
  description = "Container image for the edge server, built from server/Dockerfile (see deploy.sh)."
  type        = string
}

variable "regions" {
  description = "Cloud Run regions. Start with the one nearest you; add more with a domain + load balancer."
  type        = list(string)
  default     = ["us-west2"]
}

variable "min_instances" {
  description = "Warm instances per region. 1 avoids a cold start on the first search after a quiet period."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Cap per region. Each instance keeps its own snapshot cache, so fewer is fresher."
  type        = number
  default     = 3
}

variable "domain" {
  description = "Optional domain (e.g. go.example.com). When set, creates a global HTTPS load balancer in front of every region."
  type        = string
  default     = ""
}

variable "name" {
  description = "Prefix for every resource, so this can share a project safely."
  type        = string
  default     = "go-tools"
}
