#!/usr/bin/env python3
import asyncio
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import edge_tts

# DmitryNeural did not return audio on this pass; keep one consistent voice.
VOICE = "ru-RU-SvetlanaNeural"
RATE = "-12%"
CHUNK = 280
RETRIES = 8
TIMEOUT = 70
BASE = Path("/workspace/excursions/simonov")
CACHE = Path("/tmp/simonov-tts-svetlana")

def split_sentences(text: str):
    parts = re.split(r"(?<=[.!?…»])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]

def pack_chunks(sentences, limit):
    chunks, buf = [], ""
    for part in sentences:
        if buf and len(buf) + 1 + len(part) > limit:
            chunks.append(buf)
            buf = part
        else:
            buf = (buf + " " + part).strip()
    if buf:
        chunks.append(buf)
    return chunks

async def synth_once(text: str, path: Path):
    if path.exists():
        path.unlink()
    comm = edge_tts.Communicate(text, VOICE, rate=RATE)
    await asyncio.wait_for(comm.save(str(path)), timeout=TIMEOUT)
    return path.exists() and path.stat().st_size > 1000

async def synth_text_to_file(text: str, path: Path, label: str):
    last_err = None
    for i in range(RETRIES):
        try:
            if await synth_once(text, path):
                return
            last_err = RuntimeError("empty or tiny file")
        except Exception as e:
            last_err = e
        wait = 4 + i * 3
        print(f"    {label} retry {i+1}/{RETRIES}: {last_err}; wait {wait}s", flush=True)
        await asyncio.sleep(wait)
    raise RuntimeError(f"{label} failed: {last_err}")

async def synth_chunk_resilient(text: str, path: Path, label: str):
    if path.exists() and path.stat().st_size > 1000:
        print(f"    {label}: cached", flush=True)
        return [path]
    try:
        await synth_text_to_file(text, path, label)
        return [path]
    except RuntimeError:
        sentences = split_sentences(text)
        if len(sentences) <= 1:
            raise
        print(f"    {label}: falling back to sentences ({len(sentences)})", flush=True)
        files = []
        for j, sent in enumerate(sentences, 1):
            sub = path.with_name(path.stem + f"-s{j:02d}.mp3")
            if sub.exists() and sub.stat().st_size > 1000:
                print(f"    {label}.{j}: cached", flush=True)
            else:
                await synth_text_to_file(sent, sub, f"{label}.{j}")
            files.append(sub)
        return files

def concat_mp3(files, dest):
    listfile = dest.with_suffix(".txt")
    listfile.write_text("".join(f"file '{f}'\n" for f in files))
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
            "-c:a", "libmp3lame", "-q:a", "4", str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

async def synth_file(txt_path: Path, mp3_path: Path):
    text = txt_path.read_text(encoding="utf-8").strip()
    chunks = pack_chunks(split_sentences(text), CHUNK)
    print(f"== {txt_path.name}: {len(text.split())} words, {len(chunks)} chunks, voice={VOICE}", flush=True)
    cache = CACHE / txt_path.stem
    cache.mkdir(parents=True, exist_ok=True)
    files = []
    for i, ch in enumerate(chunks, 1):
        out = cache / f"{i:02d}.mp3"
        print(f"  chunk {i}/{len(chunks)} ({len(ch)} chars)", flush=True)
        parts = await synth_chunk_resilient(ch, out, f"chunk {i}")
        files.extend(parts)
        await asyncio.sleep(0.6)
    tmp_out = cache / "out.mp3"
    concat_mp3(files, tmp_out)
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    # copy rather than replace across filesystems
    mp3_path.write_bytes(tmp_out.read_bytes())
    print(f"  wrote {mp3_path} ({mp3_path.stat().st_size} bytes)", flush=True)

async def main():
    only = sys.argv[1:]
    scripts = sorted((BASE / "scripts").glob("*.txt"))
    if only:
        scripts = [s for s in scripts if s.stem in only or s.name in only]
    for s in scripts:
        dest = BASE / "audio" / (s.stem + ".mp3")
        await synth_file(s, dest)
    print("ALL DONE", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
