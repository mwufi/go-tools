# Optional: one domain and anycast IP for several regions. Google's front end
# sends each person to the nearest healthy region. Only created when var.domain is set.
locals {
  lb = var.domain == "" ? toset([]) : toset(["on"])
}

resource "google_compute_region_network_endpoint_group" "edge" {
  for_each              = var.domain == "" ? toset([]) : toset(var.regions)
  name                  = "${var.name}-edge-${each.value}"
  region                = each.value
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.edge[each.value].name
  }
}

resource "google_compute_backend_service" "edge" {
  for_each              = local.lb
  name                  = "${var.name}-edge"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  dynamic "backend" {
    for_each = google_compute_region_network_endpoint_group.edge
    content {
      group = backend.value.id
    }
  }
}

resource "google_compute_url_map" "edge" {
  for_each        = local.lb
  name            = "${var.name}-edge"
  default_service = google_compute_backend_service.edge["on"].id
}

resource "google_compute_managed_ssl_certificate" "edge" {
  for_each = local.lb
  name     = "${var.name}-edge"
  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "edge" {
  for_each         = local.lb
  name             = "${var.name}-edge"
  url_map          = google_compute_url_map.edge["on"].id
  ssl_certificates = [google_compute_managed_ssl_certificate.edge["on"].id]
}

resource "google_compute_global_address" "edge" {
  for_each = local.lb
  name     = "${var.name}-edge"
}

resource "google_compute_global_forwarding_rule" "https" {
  for_each              = local.lb
  name                  = "${var.name}-edge-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge["on"].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.edge["on"].id
}

# Plain http:// -> https://
resource "google_compute_url_map" "http_redirect" {
  for_each = local.lb
  name     = "${var.name}-edge-http"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  for_each = local.lb
  name     = "${var.name}-edge-http"
  url_map  = google_compute_url_map.http_redirect["on"].id
}

resource "google_compute_global_forwarding_rule" "http" {
  for_each              = local.lb
  name                  = "${var.name}-edge-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge["on"].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect["on"].id
}
