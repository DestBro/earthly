# Running Map Chunking on VPS

This guide explains how to run the map chunking process on your VPS server.

## Prerequisites

- SSH access to your VPS (`deploy@server1` or similar)
- The project deployed to `/var/www/earthly` (or your `VPS_PATH`)
- `pmtiles-cli` binary (automatically downloaded during deployment)
- Bun runtime installed on the VPS

## Overview

The chunking process downloads a large PMTiles basemap and splits it into smaller geographic chunks based on geohash precision. This process:
- Downloads from `https://build.protomaps.com/YYYYMMDD.pmtiles` (configurable)
- Takes a long time (hours to days depending on precision and maxZoom)
- Requires a stable connection (use `screen` or `nohup`)
- Outputs chunks to `map-chunks/` directory
- Creates/updates `map-chunks/announcement.json` manifest

## Quick Start

### 1. SSH to Your VPS

```bash
ssh deploy@server1
cd /var/www/earthly
```

### 2. Start a Screen Session (Recommended)

Screen allows the process to continue if your SSH connection drops:

```bash
screen -S chunk
```

### 3. Run the Chunk Command

```bash
~/.bun/bin/bun map-scripts/index.ts chunk --precision 1 --maxZoom 16
```

**Common Options:**
- `--precision N` - Geohash precision (1-12). Lower = fewer, larger chunks
  - `1` = ~32 chunks (recommended for global coverage)
  - `2` = ~1,024 chunks
  - `3` = ~32,768 chunks
- `--maxZoom N` - Maximum zoom level to include (0-22)
  - `8` = City-level detail (fast, small files)
  - `12` = Street-level detail (moderate)
  - `16` = Building-level detail (slow, large files)
  - `22` = Maximum detail (very slow, very large files)
- `--input URL_OR_PATH` - Override default basemap source
- `--force` - Reprocess existing chunks
- `--verbose` - Show detailed progress

### 4. Detach from Screen

Press `Ctrl+A` then `D` to detach. The process continues running.

### 5. Monitor Progress

Reattach to the screen session anytime:

```bash
screen -r chunk
```

List all screen sessions:

```bash
screen -ls
```

Check map-chunks directory:

```bash
ls -lh map-chunks/
cat map-chunks/announcement.json | head -20
```

## Alternative: Using nohup

If you prefer not to use screen:

```bash
cd /var/www/earthly
nohup ~/.bun/bin/bun map-scripts/index.ts chunk --precision 1 --maxZoom 16 > logs/chunk.log 2>&1 &
echo $!  # Shows process ID
```

Monitor with:

```bash
tail -f logs/chunk.log
```

Kill if needed:

```bash
ps aux | grep "map-scripts/index.ts"
kill <PID>
```

## Recommended Settings

### Fast Test (Minutes)
```bash
bun map-scripts/index.ts chunk --precision 1 --maxZoom 8
```
- ~32 chunks, city-level detail
- Quick verification that everything works

### Production Global Coverage (Hours)
```bash
bun map-scripts/index.ts chunk --precision 1 --maxZoom 14
```
- ~32 chunks, street-level detail
- Good balance of size vs detail

### High Detail Regional (Days)
```bash
bun map-scripts/index.ts chunk --precision 2 --maxZoom 16
```
- ~1,024 chunks, building-level detail
- For specific regions or high-detail needs

## Understanding Output

The script outputs JSON for each processed chunk:

```json
{
  "geohash": "0",
  "bbox": [-180, -90, -135, -45],
  "pmtiles": "a1b2c3d4e5f6...sha256hash....pmtiles"
}
```

- `geohash` - Geographic identifier
- `bbox` - Bounding box [west, south, east, north]
- `pmtiles` - SHA256-named file in `map-chunks/`

The `announcement.json` file contains all chunks and is used by the frontend.

## Troubleshooting

### Process Fails to Start

Check pmtiles-cli is present and executable:

```bash
ls -l pmtiles-cli
./pmtiles-cli --version
```

If missing, download manually:

```bash
curl -L https://github.com/protomaps/go-pmtiles/releases/download/v1.29.1/go-pmtiles_1.29.1_Linux_x86_64.tar.gz -o pmtiles.tar.gz
tar -xzf pmtiles.tar.gz pmtiles
mv pmtiles pmtiles-cli
chmod +x pmtiles-cli
rm pmtiles.tar.gz
```

### Disk Space Issues

Check available space:

```bash
df -h /var/www/earthly
```

The `map-chunks/` directory can grow large. Each chunk varies but expect:
- Precision 1, maxZoom 8: ~1-5 GB total
- Precision 1, maxZoom 14: ~10-50 GB total
- Precision 2, maxZoom 16: ~100-500 GB total

### Network Errors

The script retries failed extracts up to 3 times. If extracts consistently fail:

1. Check internet connectivity from VPS
2. Verify the basemap URL is accessible
3. Consider downloading the basemap first:

```bash
wget https://build.protomaps.com/20251222.pmtiles -O input.pmtiles
bun map-scripts/index.ts chunk --input input.pmtiles --precision 1 --maxZoom 14
```

### Resume After Interruption

The script is idempotent by default. If interrupted, just run it again:

```bash
bun map-scripts/index.ts chunk --precision 1 --maxZoom 16
```

It will skip already-processed chunks (unless `--force` is used).

## Environment Variables

Optional overrides via environment variables:

```bash
# Custom input source
export PMTILES_INPUT=/path/to/custom.pmtiles

# Enable verbose pmtiles extract output
export PMTILES_EXTRACT_VERBOSE=1

# Increase retry attempts (default: 3)
export PMTILES_EXTRACT_MAX_ATTEMPTS=5

# Run the chunk command
bun map-scripts/index.ts chunk --precision 1 --maxZoom 14
```

## After Chunking Completes

1. **Verify output:**
   ```bash
   ls -lh map-chunks/
   wc -l map-chunks/announcement.json
   ```

2. **Restart web server** (if needed to publish announcement):
   ```bash
   pm2 restart earthly-web
   ```

3. **Test in browser:**
   Visit your site and check if the map loads with the new chunks.

## Cleanup

To start fresh (removes all chunks and announcement):

```bash
rm -rf map-chunks/
mkdir map-chunks
```

Then re-run the chunk command.

## Screen Cheat Sheet

- `screen -S name` - Create new session
- `Ctrl+A, D` - Detach from session
- `screen -ls` - List sessions
- `screen -r name` - Reattach to session
- `Ctrl+A, K` - Kill current session (while attached)
- `screen -X -S name quit` - Kill session remotely

## Performance Notes

- Precision 1 processes ~32 chunks in parallel-capable fashion
- Each chunk extraction takes 1-5 minutes depending on maxZoom
- Total time scales with: precision (exponential), maxZoom (linear), and network speed
- The VPS doesn't need much RAM (~500MB), but needs good network bandwidth
- Chunks are deduplicated by SHA256 hash (identical chunks reuse same file)

## Updating the Basemap

The basemap URL is defined in `map-scripts/index.ts`:

```typescript
const DEFAULT_BASEMAP_PMTILES = "https://build.protomaps.com/20251222.pmtiles";
```

To use a newer basemap:
1. Update this URL in the code
2. Redeploy: `./scripts/deploy.sh`
3. Re-run chunking with `--force` to regenerate all chunks
