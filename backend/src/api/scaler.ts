import fs from "node:fs";
import https from "node:https";
import { config } from "../config.js";
import { HttpError } from "../core/types.js";

/**
 * Reads and overrides worker scaling through the Kubernetes API using the pod's service account.
 *
 *   keda       -> patches the KEDA ScaledObject min/max (autoscaling stays on, bounds move)
 *   hpa        -> patches the HorizontalPodAutoscaler min/max
 *   deployment -> sets Deployment replicas directly (no autoscaler)
 *   none       -> local dev; scaling is read-only
 */

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const { kind, namespace, workerDeployment, scaledObject, hpa } = config.scaling;

export interface ScalingState {
  kind: typeof kind;
  available: boolean;
  error?: string;
  deployment: { name: string; desired: number | null; ready: number | null };
  autoscaler: { min: number | null; max: number | null } | null;
  note: string;
}

function kube<T>(method: "GET" | "PATCH", path: string, body?: unknown): Promise<T> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) return Promise.reject(new HttpError(503, "Not running inside Kubernetes"));
  const token = fs.readFileSync(`${SA_DIR}/token`, "utf8");
  const ca = fs.readFileSync(`${SA_DIR}/ca.crt`);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port,
        path,
        method,
        ca,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(payload ? { "content-type": "application/merge-patch+json", "content-length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          if (status >= 400) {
            let message = data;
            try {
              message = JSON.parse(data).message ?? data;
            } catch {
              /* raw text */
            }
            reject(new HttpError(status === 403 ? 403 : 502, `Kubernetes API ${status}: ${message}`));
          } else {
            resolve(JSON.parse(data) as T);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Kubernetes API timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const deploymentPath = `/apis/apps/v1/namespaces/${namespace}/deployments/${workerDeployment}`;
const scaledObjectPath = `/apis/keda.sh/v1alpha1/namespaces/${namespace}/scaledobjects/${scaledObject}`;
const hpaPath = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${hpa}`;

export async function getScaling(): Promise<ScalingState> {
  const base: ScalingState = {
    kind,
    available: false,
    deployment: { name: workerDeployment, desired: null, ready: null },
    autoscaler: null,
    note: "",
  };
  if (kind === "none") {
    return {
      ...base,
      note: "Scaling is managed outside the platform in this environment. Locally, run `docker compose up --scale worker=N`; in Kubernetes, KEDA scales workers on queue depth.",
    };
  }
  try {
    const dep = await kube<any>("GET", deploymentPath);
    base.deployment.desired = dep.spec?.replicas ?? null;
    base.deployment.ready = dep.status?.readyReplicas ?? 0;
    if (kind === "keda") {
      const so = await kube<any>("GET", scaledObjectPath);
      base.autoscaler = { min: so.spec?.minReplicaCount ?? 0, max: so.spec?.maxReplicaCount ?? 100 };
      base.note = "KEDA scales workers on the Redis wait-list length. Overrides move its min/max bounds.";
    } else if (kind === "hpa") {
      const h = await kube<any>("GET", hpaPath);
      base.autoscaler = { min: h.spec?.minReplicas ?? 1, max: h.spec?.maxReplicas ?? 1 };
      base.note = "A HorizontalPodAutoscaler scales workers on CPU. Overrides move its min/max bounds.";
    } else {
      base.note = "No autoscaler: replicas are set directly.";
    }
    return { ...base, available: true };
  } catch (err) {
    return { ...base, error: (err as Error).message, note: "Could not reach the Kubernetes API." };
  }
}

export interface ScalingOverride {
  min?: number;
  max?: number;
  replicas?: number;
}

export async function setScaling(override: ScalingOverride): Promise<ScalingState> {
  if (kind === "none") throw new HttpError(409, "Scaling overrides need the API to run in Kubernetes (SCALER_KIND)");
  const { min, max, replicas } = override;
  if (min !== undefined && max !== undefined && min > max) throw new HttpError(400, "min must be <= max");

  if (kind === "deployment") {
    if (replicas === undefined) throw new HttpError(400, "replicas is required when SCALER_KIND=deployment");
    await kube("PATCH", `${deploymentPath}/scale`, { spec: { replicas } });
  } else if (kind === "keda") {
    await kube("PATCH", scaledObjectPath, {
      spec: { ...(min !== undefined ? { minReplicaCount: min } : {}), ...(max !== undefined ? { maxReplicaCount: max } : {}) },
    });
  } else {
    await kube("PATCH", hpaPath, {
      spec: { ...(min !== undefined ? { minReplicas: Math.max(min, 1) } : {}), ...(max !== undefined ? { maxReplicas: max } : {}) },
    });
  }
  return getScaling();
}
