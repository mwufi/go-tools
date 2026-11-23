locals {
  services = toset(["run.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "compute.googleapis.com"])
}

resource "google_project_service" "apis" {
  for_each           = local.services
  service            = each.value
  disable_on_destroy = false
}

# Where deploy.sh pushes the edge image.
resource "google_artifact_registry_repository" "images" {
  location      = var.regions[0]
  repository_id = var.name
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# The edge server needs no Google APIs: a dedicated identity with no roles.
resource "google_service_account" "edge" {
  account_id   = "${var.name}-edge"
  display_name = "go-tools edge server (no permissions)"
}

# One Cloud Run service per region, all running the same image.
resource "google_cloud_run_v2_service" "edge" {
  for_each            = toset(var.regions)
  name                = "${var.name}-edge"
  location            = each.value
  ingress             = var.domain == "" ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false

  template {
    service_account                  = google_service_account.edge.email
    session_affinity                 = true # keeps a browser on the instance its /_refresh warmed
    max_instance_request_concurrency = 250  # redirects are ~1 ms of CPU; one instance handles a lot

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      env {
        name  = "CONVEX_SITE"
        value = var.convex_site
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = true # only billed for CPU while serving
        startup_cpu_boost = true
      }
      startup_probe {
        http_get {
          path = "/_health"
        }
        period_seconds    = 1
        failure_threshold = 10
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# Public: the browser calls it directly. (An org policy that restricts allUsers
# would block this; then front it with the load balancer + IAP or a domain.)
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = google_cloud_run_v2_service.edge
  name     = each.value.name
  location = each.value.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
