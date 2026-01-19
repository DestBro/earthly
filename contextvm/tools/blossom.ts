/**
 * Blossom upload helpers for ContextVM
 *
 * Handles uploading PMTiles files to Blossom servers with signed auth events.
 * Implements BUD-02 (upload) and BUD-06 (pre-upload check).
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export interface SignedEvent {
	id: string;
	pubkey: string;
	kind: number;
	created_at: number;
	tags: string[][];
	content: string;
	sig: string;
}

export interface UploadResult {
	blobUrl: string;
	sha256: string;
}

/**
 * Check if a Blossom server is reachable and accepts uploads
 */
export async function checkBlossomServer(
	blossomUrl: string,
	sha256: string,
	fileSizeBytes: number,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const url = new URL("/upload", blossomUrl);

		const response = await fetch(url.toString(), {
			method: "HEAD",
			headers: {
				"X-SHA-256": sha256,
				"X-Content-Length": String(fileSizeBytes),
				"X-Content-Type": "application/octet-stream",
			},
		});

		if (response.ok) {
			return { ok: true };
		}

		const reason = response.headers.get("X-Reason") || response.statusText;
		return {
			ok: false,
			error: `Blossom server rejected upload: ${reason} (${response.status})`,
		};
	} catch (err: any) {
		return {
			ok: false,
			error: `Cannot reach Blossom server: ${err.message}`,
		};
	}
}

/**
 * Upload a file to Blossom with a signed authorization event
 */
export async function uploadToBlossomWithAuth(
	blossomUrl: string,
	filePath: string,
	signedEvent: SignedEvent,
): Promise<UploadResult> {
	// Get file stats
	const fileStat = await stat(filePath);
	const fileSize = fileStat.size;

	// Build authorization header (base64 encoded signed event)
	const authHeader = `Nostr ${Buffer.from(JSON.stringify(signedEvent)).toString("base64")}`;

	// Create upload URL
	const url = new URL("/upload", blossomUrl);

	console.log(
		`📤 Uploading to Blossom: ${url.toString()} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
	);

	// Stream the file to the server
	const fileStream = createReadStream(filePath);
	const chunks: Buffer[] = [];

	for await (const chunk of fileStream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const fileBuffer = Buffer.concat(chunks);

	const response = await fetch(url.toString(), {
		method: "PUT",
		headers: {
			Authorization: authHeader,
			"Content-Type": "application/octet-stream",
			"Content-Length": String(fileSize),
		},
		body: fileBuffer,
	});

	if (!response.ok) {
		const reason = response.headers.get("X-Reason") || (await response.text());
		throw new Error(`Upload failed: ${reason} (${response.status})`);
	}

	// Parse response - Blossom returns the blob descriptor
	const result = (await response.json()) as {
		sha256: string;
		url?: string;
		size?: number;
	};

	// Build blob URL
	const blobUrl = result.url || `${blossomUrl}/${result.sha256}`;

	console.log(`✅ Upload complete: ${blobUrl}`);

	return {
		blobUrl,
		sha256: result.sha256,
	};
}
