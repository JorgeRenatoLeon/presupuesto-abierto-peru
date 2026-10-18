"""MEF file server client: HEAD-based catalog / change detection and chunked, resumable downloads.

The server throttles long-lived connections (measured 2026-09-27: one GET falls to
~0.2 MB/s after ~130 MB, while a fresh connection starts at 2-4 MB/s; parallel
connections share ~2 MB/s). So files are fetched as *sequential* Range requests of
CHUNK bytes, each on a new connection. If-Range pins every chunk to the ETag seen
by HEAD: if MEF replaces the file mid-download the server answers 200 instead of
206, and we raise SourceChanged instead of stitching two versions together.
"""
import json
import time
from pathlib import Path

import requests

from config import (
    BASE_URL, RAW, candidate_files, DICTIONARY_FILE,
    ingreso_candidate_files, DICTIONARY_FILE_INGRESOS, source_files,
)

TIMEOUT = 60
RETRIES = 6
CHUNK = 32 << 20  # 32 MiB per request, each on a fresh connection


class SourceChanged(Exception):
    """The file on the server changed (new ETag) while we were downloading it."""


def head(name: str) -> dict | None:
    """File metadata from the MEF server, or None if it doesn't exist (404).
    Anything else (timeouts, 5xx, blocked IPs) raises after retries: "couldn't check" must
    never look like "no file" (on 2026-10-16 that turned a failed run into a silent success)."""
    url = f"{BASE_URL}/{name}"
    ultimo = None
    for attempt in range(RETRIES):
        try:
            r = requests.head(url, timeout=TIMEOUT, allow_redirects=True, headers={"Connection": "close"})
            if r.status_code == 200:
                return {
                    "name": name,
                    "url": url,
                    "size": int(r.headers.get("Content-Length", 0)),
                    "etag": r.headers.get("ETag"),
                    "last_modified": r.headers.get("Last-Modified"),
                    "accept_ranges": r.headers.get("Accept-Ranges") == "bytes",
                }
            if r.status_code == 404:
                return None
            ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            ultimo = str(e)
        time.sleep(2 ** attempt)
    raise IOError(f"MEF server: could not check {name} after {RETRIES} attempts ({ultimo})")


def resolve_source(dataset: str, year: int, prefer_diario: bool = False) -> dict | None:
    """First existing file (in preference order) for a dataset-year, with its metadata."""
    candidatos = source_files(dataset, year, prefer_diario)
    for name in candidatos:
        info = head(name)
        if info:
            if name != candidatos[0]:
                print(f"  note: {candidatos[0]} not on the server; using {name}")
            return info
    return None


def catalog(years: list[int]) -> dict:
    """Probe the file server for existing files. Writes data/raw/catalog.json."""
    result: dict = {"base_url": BASE_URL, "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "files": {}}
    names = [DICTIONARY_FILE, DICTIONARY_FILE_INGRESOS] + [
        n for y in years for n in candidate_files(y) + ingreso_candidate_files(y)
    ]
    for name in names:
        try:
            info = head(name)
        except IOError as e:
            print(f"  ERROR {e}")
            continue
        if info:
            result["files"][name] = info
            print(f"  FOUND {name}  {info['size']/1e6:.1f} MB  (modified {info['last_modified']})")
    out = RAW / "catalog.json"
    out.write_text(json.dumps(result, indent=2))
    print(f"\nCatalog: {len(result['files'])} files -> {out}")
    return result


def fetch(info: dict, dest: Path) -> Path:
    """Download info['url'] to dest as sequential Range chunks on fresh connections.

    Resumable: a `.part` file is continued if it belongs to the same ETag.
    """
    size, etag = info["size"], info.get("etag")
    part = dest.with_name(dest.name + ".part")
    meta = dest.with_name(dest.name + ".part.json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if part.exists() and (not meta.exists() or json.loads(meta.read_text()).get("etag") != etag):
        part.unlink()  # partial download of a different version
    meta.write_text(json.dumps({"etag": etag, "size": size}))

    done = part.stat().st_size if part.exists() else 0
    t0, done0, last_report = time.time(), done, done
    with open(part, "ab") as f:
        while done < size:
            end = min(done + CHUNK, size) - 1
            headers = {"Range": f"bytes={done}-{end}", "Connection": "close"}
            if etag:
                headers["If-Range"] = etag
            body = _get_range(info["url"], headers, end - done + 1)
            f.write(body)
            done += len(body)
            if done - last_report >= 128 << 20 or done == size:
                rate = (done - done0) / max(time.time() - t0, 1e-6) / 1e6
                print(f"    {info['name']}: {done/1e6:,.0f}/{size/1e6:,.0f} MB ({rate:.1f} MB/s)", flush=True)
                last_report = done

    if part.stat().st_size != size:
        raise IOError(f"{info['name']}: got {part.stat().st_size} bytes, expected {size}")
    part.rename(dest)
    meta.unlink()
    sidecar(dest).write_text(json.dumps(info))
    return dest


def sidecar(dest: Path) -> Path:
    """Metadata of a completed download (which ETag/version the file on disk is)."""
    return dest.with_name(dest.name + ".json")


def is_downloaded(info: dict, dest: Path) -> bool:
    s = sidecar(dest)
    return (dest.exists() and dest.stat().st_size == info["size"] and s.exists()
            and json.loads(s.read_text()).get("etag") == info.get("etag"))


def _get_range(url: str, headers: dict, expected: int) -> bytes:
    for attempt in range(RETRIES):
        try:
            with requests.get(url, headers=headers, timeout=TIMEOUT, stream=True) as r:
                if r.status_code == 200:
                    raise SourceChanged(f"{url} changed on the server (If-Range mismatch)")
                r.raise_for_status()
                body = r.content
            if r.status_code == 206 and len(body) == expected:
                return body
            raise requests.RequestException(f"short or invalid range response ({r.status_code}, {len(body)} bytes)")
        except requests.RequestException as e:
            if attempt == RETRIES - 1:
                raise
            wait = 2 ** attempt
            print(f"    retry {attempt + 1}/{RETRIES} in {wait}s: {e}", flush=True)
            time.sleep(wait)
    raise AssertionError("unreachable")


def download(year: int, prefer_diario: bool = False, dataset: str = "gasto") -> list[Path]:
    """Manual download of a year's source file into data/raw (the `download` command)."""
    info = resolve_source(dataset, year, prefer_diario)
    if not info:
        raise SystemExit(f"No {dataset} file found for {year} on {BASE_URL}.")
    dest = RAW / info["name"]
    if is_downloaded(info, dest):
        print(f"  OK (cached) {info['name']}")
        return [dest]
    print(f"  downloading {info['name']} ({info['size']/1e6:,.0f} MB, modified {info['last_modified']})")
    return [fetch(info, dest)]
