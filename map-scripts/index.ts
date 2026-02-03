import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getWorldGeohashBboxes,
  iterateWorldGeohashBboxes,
  geohashToBBox,
  type BBox,
} from "./geohashWorld";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DEFAULT_BASEMAP_PMTILES = "https://build.protomaps.com/20251222.pmtiles";
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

const [, , command, ...args] = Bun.argv;

if (command === "chunk") {
  await chunkPmtiles(args);
} else if (command === "add-layer") {
  await addLayer(args);
} else {
  logWorldGeohashBboxes();
}

function logWorldGeohashBboxes() {
  const precision = Number(Bun.env.GEOHASH_PRECISION ?? "1");
  const maxGeohashes = BigInt(Bun.env.GEOHASH_MAX_GEOHASHES ?? "1000000");
  const full = Bun.env.GEOHASH_FULL === "1";

  const map = getWorldGeohashBboxes(precision, { maxGeohashes });

  if (full) {
    console.log([...map.entries()]);
  } else {
    const entries = [...map.entries()];
    console.log({
      precision,
      count: entries.length,
      sample: entries.slice(0, 5),
      last: entries.slice(-5),
    });
  }
}

async function chunkPmtiles(argv: string[]) {
  const {
    precision,
    maxZoom,
    input: inputArg,
    force,
    verbose,
    maxSizeBytes,
  } = parseChunkArgs(argv);

  const input = await resolveInputPmtiles(inputArg);

  const pmtilesBin = join(PROJECT_ROOT, "pmtiles-cli");
  await mustExist(pmtilesBin);

  const outputDir = join(PROJECT_ROOT, "map-chunks");
  const tmpDir = join(outputDir, `.tmp-${Date.now().toString(36)}`);
  await mkdir(tmpDir, { recursive: true });

  const announcementPath = join(outputDir, "announcement.json");
  const announcement = await readAnnouncement(announcementPath);

  let total = 0;
  let skipped = 0;
  let reused = 0;

  try {
    for (const [geohash, bbox] of iterateWorldGeohashBboxes(precision)) {
      total++;
      if (verbose) console.log({ geohash, bbox, action: "start" });

      if (!force) {
        const existing = announcement[geohash];
        if (
          existing &&
          existing.maxZoom === maxZoom &&
          bboxEquals(existing.bbox, bbox)
        ) {
          const existingPath = join(outputDir, existing.file);
          if (await fileExists(existingPath)) {
            skipped++;
            console.log({
              geohash,
              bbox,
              pmtiles: existing.file,
              skipped: true,
            });
            continue;
          }
        }
      }

      const tmpOut = join(tmpDir, `${geohash}.pmtiles`);
      await pmtilesExtract({
        pmtilesBin,
        input,
        output: tmpOut,
        bbox,
        maxZoom,
        verbose,
      });

      const sha256Hex = await sha256FileHex(tmpOut);
      const finalOut = join(outputDir, `${sha256Hex}.pmtiles`);
      const pmtilesFileName = `${sha256Hex}.pmtiles`;

      if (await fileExists(finalOut)) {
        reused++;
        await rm(tmpOut, { force: true });
      } else {
        await Bun.write(finalOut, Bun.file(tmpOut));
        await rm(tmpOut, { force: true });
      }

      announcement[geohash] = { bbox, file: pmtilesFileName, maxZoom };
      await writeAnnouncement(announcementPath, announcement);

      console.log({ geohash, bbox, pmtiles: pmtilesFileName });

      // Check if subdivision is needed based on file size
      if (maxSizeBytes !== undefined) {
        const chunkPath = join(outputDir, pmtilesFileName);
        const chunkStats = await stat(chunkPath);
        const chunkSize = chunkStats.size;

        if (chunkSize > maxSizeBytes) {
          const sizeMB = (chunkSize / 1024 / 1024).toFixed(1);
          const thresholdMB = (maxSizeBytes / 1024 / 1024).toFixed(1);
          console.log({
            geohash,
            size: `${sizeMB}MB`,
            threshold: `${thresholdMB}MB`,
            action: "subdivide_needed",
          });

          // Subdivide using the existing chunk as source
          const subAnnouncements = await subdivideChunk({
            pmtilesBin,
            sourceFile: chunkPath,
            parentGeohash: geohash,
            maxZoom,
            outputDir,
            tmpDir,
            verbose,
          });

          // Remove parent geohash from announcement and add children
          delete announcement[geohash];
          Object.assign(announcement, subAnnouncements);
          await writeAnnouncement(announcementPath, announcement);
        }
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log({
    input,
    precision,
    maxZoom,
    force,
    total,
    skipped,
    reused,
    outputDir,
    announcementPath,
  });
}

/**
 * Subdivide an oversized PMTiles chunk into 32 child geohashes (next precision level).
 * Uses the parent chunk file as the source for extraction (avoids re-downloading).
 */
async function subdivideChunk(args: {
  pmtilesBin: string;
  sourceFile: string;
  parentGeohash: string;
  maxZoom: number;
  outputDir: string;
  tmpDir: string;
  verbose: boolean;
}): Promise<AnnouncementRecord> {
  const {
    pmtilesBin,
    sourceFile,
    parentGeohash,
    maxZoom,
    outputDir,
    tmpDir,
    verbose,
  } = args;
  const result: AnnouncementRecord = {};

  console.log({ parentGeohash, action: "subdivide_start", children: 32 });

  for (const char of BASE32) {
    const childGeohash = parentGeohash + char;
    const childBbox = geohashToBBox(childGeohash);

    if (verbose) {
      console.log({ childGeohash, childBbox, action: "subdivide_extract" });
    }

    const tmpOut = join(tmpDir, `${childGeohash}.pmtiles`);

    // Use the parent chunk as source (local file, not remote)
    await pmtilesExtract({
      pmtilesBin,
      input: sourceFile,
      output: tmpOut,
      bbox: childBbox,
      maxZoom,
      verbose,
    });

    const sha256Hex = await sha256FileHex(tmpOut);
    const finalOut = join(outputDir, `${sha256Hex}.pmtiles`);
    const pmtilesFileName = `${sha256Hex}.pmtiles`;

    if (await fileExists(finalOut)) {
      // Content already exists (deduplication)
      await rm(tmpOut, { force: true });
    } else {
      await Bun.write(finalOut, Bun.file(tmpOut));
      await rm(tmpOut, { force: true });
    }

    result[childGeohash] = {
      bbox: childBbox,
      file: pmtilesFileName,
      maxZoom,
    };

    console.log({ childGeohash, pmtiles: pmtilesFileName });
  }

  console.log({
    parentGeohash,
    action: "subdivide_complete",
    children: Object.keys(result).length,
  });

  return result;
}

type LayerAnnouncement = {
  id: string;
  title: string;
  kind: "pmtiles";
  pmtilesType: "raster" | "vector";
  file: string;
  defaultEnabled?: boolean;
  defaultOpacity?: number;
};

async function addLayer(argv: string[]) {
  const {
    id,
    title,
    pmtilesPath,
    pmtilesType,
    defaultEnabled,
    defaultOpacity,
  } = parseAddLayerArgs(argv);
  const outputDir = join(PROJECT_ROOT, "map-chunks");
  await mkdir(outputDir, { recursive: true });

  let localPath: string;
  let tempFile: string | null = null;

  if (isHttpUrl(pmtilesPath)) {
    // Download remote file to temp location
    console.log({ action: "download", url: pmtilesPath });
    const tmpDir = join(outputDir, `.tmp-${Date.now().toString(36)}`);
    await mkdir(tmpDir, { recursive: true });
    tempFile = join(tmpDir, `${id}.pmtiles`);

    const response = await fetch(pmtilesPath);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${pmtilesPath}: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(tempFile, arrayBuffer);
    localPath = tempFile;
    console.log({
      action: "downloaded",
      bytes: arrayBuffer.byteLength,
      path: tempFile,
    });
  } else {
    localPath = join(PROJECT_ROOT, pmtilesPath);
    await mustExist(localPath);
  }

  const sha = await sha256FileHex(localPath);
  const outFileName = `${sha}.pmtiles`;
  const outPath = join(outputDir, outFileName);

  if (!(await fileExists(outPath))) {
    await copyFile(localPath, outPath);
    console.log({ action: "stored", file: outFileName });
  } else {
    console.log({ action: "exists", file: outFileName });
  }

  // Cleanup temp file if we downloaded
  if (tempFile) {
    const tmpDir = join(tempFile, "..");
    await rm(tmpDir, { recursive: true, force: true });
  }

  const announcement: LayerAnnouncement = {
    id,
    title,
    kind: "pmtiles",
    pmtilesType,
    file: outFileName,
    defaultEnabled,
    defaultOpacity,
  };

  const announcementPath = join(outputDir, `${id}.announcement.json`);
  await Bun.write(
    announcementPath,
    JSON.stringify(announcement, null, 2) + "\n",
  );

  console.log({ id, title, pmtilesType, file: outFileName, announcementPath });
}

function parseChunkArgs(argv: string[]): {
  precision: number;
  maxZoom: number;
  input?: string;
  force: boolean;
  verbose: boolean;
  maxSizeBytes?: number;
} {
  let precision: number | undefined;
  let maxZoom: number | undefined;
  let input: string | undefined;
  let force = false;
  let verbose = false;
  let maxSizeBytes: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--precision" || a === "-p") {
      precision = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (a.startsWith("--precision=")) {
      precision = Number(a.slice("--precision=".length));
      continue;
    }

    if (a === "--maxZoom" || a === "--maxzoom" || a === "-z") {
      maxZoom = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (a.startsWith("--maxZoom=") || a.startsWith("--maxzoom=")) {
      const [, v] = a.split("=", 2);
      maxZoom = Number(v);
      continue;
    }

    if (a === "--input" || a === "-i") {
      input = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--input=")) {
      input = a.slice("--input=".length);
      continue;
    }

    if (a === "--basemap" || a === "-b") {
      input = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--basemap=")) {
      input = a.slice("--basemap=".length);
      continue;
    }

    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--no-force") {
      force = false;
      continue;
    }

    if (a === "--verbose" || a === "-v") {
      verbose = true;
      continue;
    }
    if (a === "--no-verbose") {
      verbose = false;
      continue;
    }

    if (a === "--max-size" || a === "-s") {
      maxSizeBytes = parseHumanSize(argv[i + 1]!);
      i++;
      continue;
    }
    if (a.startsWith("--max-size=")) {
      maxSizeBytes = parseHumanSize(a.slice("--max-size=".length));
      continue;
    }

    if (!a.startsWith("-") && precision === undefined) {
      precision = Number(a);
      continue;
    }
    if (!a.startsWith("-") && maxZoom === undefined) {
      maxZoom = Number(a);
      continue;
    }
    if (!a.startsWith("-") && input === undefined) {
      input = a;
      continue;
    }
  }

  precision ??= 1;
  maxZoom ??= 16;

  if (!Number.isInteger(precision) || precision <= 0)
    throw new Error(`precision must be a positive integer`);
  if (!Number.isInteger(maxZoom) || maxZoom < 0)
    throw new Error(`maxZoom must be an integer >= 0`);

  return { precision, maxZoom, input, force, verbose, maxSizeBytes };
}

/**
 * Parse a human-readable size string (e.g., "10GB", "500MB") into bytes.
 */
function parseHumanSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match)
    throw new Error(
      `Invalid size format: ${sizeStr}. Use format like "10GB", "500MB", "1024KB"`,
    );
  const value = parseFloat(match[1]!);
  const unit = (match[2] || "B").toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  };
  return Math.floor(value * multipliers[unit]!);
}

function parseAddLayerArgs(argv: string[]): {
  id: string;
  title: string;
  pmtilesPath: string;
  pmtilesType: "raster" | "vector";
  defaultEnabled: boolean;
  defaultOpacity: number;
} {
  let id: string | undefined;
  let title: string | undefined;
  let pmtilesPath: string | undefined;
  let pmtilesType: "raster" | "vector" | undefined;
  let defaultEnabled = false;
  let defaultOpacity = 0.7;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    if (a === "--id") {
      id = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--id=")) {
      id = a.slice("--id=".length);
      continue;
    }

    if (a === "--title") {
      title = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--title=")) {
      title = a.slice("--title=".length);
      continue;
    }

    if (a === "--pmtiles") {
      pmtilesPath = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--pmtiles=")) {
      pmtilesPath = a.slice("--pmtiles=".length);
      continue;
    }

    if (a === "--pmtilesType") {
      pmtilesType = argv[i + 1] as any;
      i++;
      continue;
    }
    if (a.startsWith("--pmtilesType=")) {
      pmtilesType = a.slice("--pmtilesType=".length) as any;
      continue;
    }

    if (a === "--enabled") {
      defaultEnabled = true;
      continue;
    }
    if (a === "--disabled") {
      defaultEnabled = false;
      continue;
    }

    if (a === "--opacity") {
      defaultOpacity = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (a.startsWith("--opacity=")) {
      defaultOpacity = Number(a.slice("--opacity=".length));
      continue;
    }

    if (!a.startsWith("-") && !pmtilesPath) {
      pmtilesPath = a;
      continue;
    }
  }

  if (!id) throw new Error(`--id is required`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id))
    throw new Error(`--id must match ^[a-z0-9][a-z0-9._-]*$`);
  title ??= id;
  if (!pmtilesPath) throw new Error(`--pmtiles is required`);
  pmtilesType ??= "raster";
  if (pmtilesType !== "raster" && pmtilesType !== "vector")
    throw new Error(`--pmtilesType must be raster or vector`);
  if (
    !Number.isFinite(defaultOpacity) ||
    defaultOpacity < 0 ||
    defaultOpacity > 1
  )
    throw new Error(`--opacity must be 0..1`);

  return {
    id,
    title,
    pmtilesPath,
    pmtilesType,
    defaultEnabled,
    defaultOpacity,
  };
}

async function resolveInputPmtiles(inputArg?: string): Promise<string> {
  const candidates: string[] = [];
  if (inputArg) candidates.push(inputArg);
  if (Bun.env.PMTILES_INPUT) candidates.push(Bun.env.PMTILES_INPUT);
  candidates.push(join(PROJECT_ROOT, "input.pmtiles"));

  for (const c of candidates) {
    if (isHttpUrl(c)) return c;
    if (await fileExists(c)) return c;
  }

  const discovered = await discoverPmtilesInRoot();
  if (discovered) return discovered;

  return DEFAULT_BASEMAP_PMTILES;
}

async function discoverPmtilesInRoot(): Promise<string | null> {
  const entries = await readdir(PROJECT_ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".pmtiles")) continue;
    return join(PROJECT_ROOT, e.name);
  }
  return null;
}

async function pmtilesExtract(args: {
  pmtilesBin: string;
  input: string;
  output: string;
  bbox: BBox;
  maxZoom: number;
  verbose: boolean;
}) {
  const { pmtilesBin, input, output, bbox, maxZoom } = args;
  const bboxStr = bbox.join(",");
  const verbose = args.verbose || Bun.env.PMTILES_EXTRACT_VERBOSE === "1";
  const maxAttempts = Number(Bun.env.PMTILES_EXTRACT_MAX_ATTEMPTS ?? "5");
  // Exponential backoff: 5s, 15s, 30s, 60s for remote sources
  const getBackoffMs = (attempt: number) => Math.min(5000 * Math.pow(2, attempt - 1), 60000);

  const baseArgs = [
    "extract",
    input,
    output,
    `--bbox=${bboxStr}`,
    "--minzoom",
    "0",
    "--maxzoom",
    String(maxZoom),
  ];
  const childArgs = verbose ? baseArgs : [...baseArgs, "--quiet"];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await rm(output, { force: true });

    const startedAt = performance.now();
    if (verbose) {
      console.log({ pmtiles: "extract", attempt, bbox: bboxStr, maxZoom });
    }

    const proc = spawn(pmtilesBin, childArgs, {
      stdio: verbose ? "inherit" : ["ignore", "ignore", "pipe"],
    });
    const stderrTextPromise = proc.stderr
      ? readNodeStreamTailText(proc.stderr, 64 * 1024)
      : Promise.resolve("");

    const exit = await waitForChild(proc);
    const exitCode = exit.code;
    const stderrText = verbose ? "" : await stderrTextPromise.catch(() => "");

    if (exitCode === 0) {
      if (verbose) {
        const ms = Math.round(performance.now() - startedAt);
        console.log({ pmtiles: "extract_done", bbox: bboxStr, maxZoom, ms });
      }
      return;
    }

    if (attempt < maxAttempts) {
      const backoffMs = getBackoffMs(attempt);
      console.log({ pmtiles: "extract_retry", attempt, nextAttempt: attempt + 1, backoffMs, bbox: bboxStr });
      await sleep(backoffMs);
      continue;
    }

    const tail = stderrText ? `\n${stderrText.trim().slice(-4000)}` : "";
    const signal = exit.signal ? ` (signal ${exit.signal})` : "";
    throw new Error(
      `pmtiles extract failed (exit ${exitCode}${signal}) for bbox ${bboxStr}${tail}`,
    );
  }
}

async function sleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readNodeStreamTailText(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buf.byteLength === 0) continue;
    chunks.push(buf);
    total += buf.byteLength;

    while (total > maxBytes && chunks.length > 0) {
      const removed = chunks.shift()!;
      total -= removed.byteLength;
    }
  }

  return Buffer.concat(chunks, total).toString("utf8");
}

async function waitForChild(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function sha256FileHex(filePath: string): Promise<string> {
  const hasher = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => {
      hasher.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => resolve());
  });
  return hasher.digest("hex");
}

function bboxEquals(a: BBox, b: BBox): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type AnnouncementRecord = Record<
  string,
  { bbox: BBox; file: string; maxZoom: number }
>;

async function readAnnouncement(filePath: string): Promise<AnnouncementRecord> {
  if (!(await fileExists(filePath))) return {};
  try {
    return (await Bun.file(filePath).json()) as AnnouncementRecord;
  } catch {
    return {};
  }
}

async function writeAnnouncement(filePath: string, record: AnnouncementRecord) {
  const json = JSON.stringify(record, null, 2) + "\n";
  await Bun.write(filePath, json);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

async function mustExist(path: string) {
  if (!(await fileExists(path)))
    throw new Error(`Missing required path: ${path}`);
}
