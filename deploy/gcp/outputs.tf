output "edge_urls" {
  description = "Per-region run.app URLs. With no domain, use the first one as GO_EDGE_URL."
  value       = { for r, s in google_cloud_run_v2_service.edge : r => s.uri }
}

output "edge_url" {
  description = "What to set as GO_EDGE_URL in Convex."
  value       = var.domain == "" ? google_cloud_run_v2_service.edge[var.regions[0]].uri : "https://${var.domain}"
}

output "dns_record" {
  description = "With a domain: point an A record at this address, then wait for the certificate."
  value       = var.domain == "" ? null : "${var.domain} A ${google_compute_global_address.edge["on"].address}"
}

output "image_repo" {
  value = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
