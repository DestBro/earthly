/**
 * Helper for parsing JSON in a web worker to avoid blocking the main thread.
 * Falls back to synchronous parsing if workers aren't available.
 */

import type { ParseRequest, ParseResponse } from "./geoJsonParseWorker";

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker) return worker;

  // Check if we're in a browser environment with Worker support
  if (typeof Worker === "undefined") {
    return null;
  }

  try {
    // Create worker using the URL pattern that works with bundlers
    worker = new Worker(
      new URL("./geoJsonParseWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      const { id, success, data, error } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;

      pendingRequests.delete(id);
      if (success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(error ?? "Worker parse failed"));
      }
    };

    worker.onerror = (error) => {
      console.warn("GeoJSON parse worker error, falling back to sync parse:", error);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error("Worker error"));
        pendingRequests.delete(id);
      }
      // Terminate broken worker
      worker?.terminate();
      worker = null;
    };

    return worker;
  } catch (error) {
    console.warn("Failed to create GeoJSON parse worker:", error);
    return null;
  }
}

/**
 * Parse JSON text using a web worker if available, otherwise synchronously.
 * This prevents UI freezing for large JSON files (10MB+).
 */
export async function parseJsonInWorker<T = unknown>(text: string): Promise<T> {
  const w = getWorker();

  // Fall back to sync parsing if worker not available
  if (!w) {
    return JSON.parse(text) as T;
  }

  const id = `parse-${++requestId}`;

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (data: unknown) => void,
      reject,
    });

    const request: ParseRequest = { id, text };
    w.postMessage(request);

    // Timeout after 30 seconds - fall back to sync if worker is stuck
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        console.warn("Worker parse timeout, falling back to sync");
        try {
          resolve(JSON.parse(text) as T);
        } catch (error) {
          reject(error);
        }
      }
    }, 30000);
  });
}

/**
 * Terminate the worker (useful for cleanup or testing).
 */
export function terminateParseWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pendingRequests.clear();
  }
}
