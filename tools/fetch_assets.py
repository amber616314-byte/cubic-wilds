#!/usr/bin/env python3
"""Fetch Minecraft 1.8.8-compatible reference assets for local development.

The public repository intentionally does not redistribute Mojang/Microsoft game
assets. This helper downloads the required files from official Minecraft asset
endpoints into the local ``assets/`` directory. Run it from the project root:

    python3 tools/fetch_assets.py

The script is idempotent: files that are already present are skipped.
"""
from __future__ import annotations

import io
import json
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEX_DIR = ROOT / "assets" / "textures"
SOUND_DIR = ROOT / "assets" / "sounds"

VERSION_JSON_URL = (
    "https://piston-meta.mojang.com/v1/packages/"
    "690172f1227e1c1d2fa8fceadd0f578f7851a69e/1.8.8.json"
)
RESOURCE_BASE = "https://resources.download.minecraft.net/"

TEXTURES = [
    # blocks
    "blocks/bedrock.png", "blocks/brick.png", "blocks/cobblestone.png",
    "blocks/crafting_table_side.png", "blocks/crafting_table_top.png",
    "blocks/coal_ore.png", "blocks/diamond_ore.png", "blocks/dirt.png",
    "blocks/glass.png", "blocks/gold_ore.png", "blocks/grass_side.png",
    "blocks/grass_top.png", "blocks/gravel.png", "blocks/iron_ore.png",
    "blocks/leaves_oak.png", "blocks/leaves_birch.png", "blocks/leaves_spruce.png",
    "blocks/log_oak.png", "blocks/log_oak_top.png", "blocks/log_birch.png",
    "blocks/log_birch_top.png", "blocks/log_spruce.png", "blocks/log_spruce_top.png",
    "blocks/planks_oak.png", "blocks/sand.png", "blocks/snow.png",
    "blocks/stone.png", "blocks/water_still.png", "blocks/water_flow.png",
    "blocks/lava_still.png", "blocks/lava_flow.png", "blocks/tallgrass.png",
    "blocks/flower_rose.png", "blocks/flower_dandelion.png",
    "blocks/redstone_ore.png", "blocks/obsidian.png", "blocks/stonebrick.png",
    "blocks/sandstone_normal.png", "blocks/sandstone_top.png",
] + [f"blocks/destroy_stage_{i}.png" for i in range(10)]

GUI = [
    "gui/widgets.png", "gui/icons.png", "gui/options_background.png",
] + [f"gui/title/background/panorama_{i}.png" for i in range(6)]

ENVIRONMENT = ["environment/clouds.png", "environment/sun.png",
               "environment/moon_phases.png", "environment/rain.png",
               "environment/snow.png"]

ENTITY = ["entity/steve.png"]

PARTICLE = ["particle/particles.png"]

# Sound files kept in the browser build.  Path is relative to minecraft/sounds.
SOUNDS = [
    # digging / mining
    *[f"dig/grass{i}.ogg" for i in range(1, 5)],
    *[f"dig/stone{i}.ogg" for i in range(1, 5)],
    *[f"dig/wood{i}.ogg" for i in range(1, 5)],
    *[f"dig/sand{i}.ogg" for i in range(1, 5)],
    *[f"dig/gravel{i}.ogg" for i in range(1, 5)],
    *[f"dig/cloth{i}.ogg" for i in range(1, 5)],
    *[f"dig/snow{i}.ogg" for i in range(1, 5)],
    # footsteps
    *[f"step/grass{i}.ogg" for i in range(1, 7)],
    *[f"step/stone{i}.ogg" for i in range(1, 7)],
    *[f"step/wood{i}.ogg" for i in range(1, 7)],
    *[f"step/sand{i}.ogg" for i in range(1, 6)],
    *[f"step/gravel{i}.ogg" for i in range(1, 5)],
    *[f"step/snow{i}.ogg" for i in range(1, 5)],
    *[f"step/cloth{i}.ogg" for i in range(1, 5)],
    # interface / events
    "random/break.ogg", "random/click.ogg", "random/pop.ogg",
    "random/levelup.ogg", "random/wood_click.ogg", "random/successful_hit.ogg",
    "random/orb.ogg", "random/splash.ogg", "random/classic_hurt.ogg",
    # glass + player hurt (exact 1.8 sounds.json mappings)
    *[f"random/glass{i}.ogg" for i in range(1, 4)],
    *[f"damage/hit{i}.ogg" for i in range(1, 4)],
    "damage/fallbig.ogg", "damage/fallsmall.ogg",
    # liquid
    "liquid/splash.ogg", "liquid/splash2.ogg", "liquid/water.ogg",
    "liquid/lava.ogg", "liquid/lavapop.ogg", *[f"liquid/swim{i}.ogg" for i in range(1, 5)],
    # music (ambient in-game + menu)
    "music/game/calm1.ogg", "music/menu/menu1.ogg",
]


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "voxelcraft-reborn-assets/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def extract_textures(jar_bytes: bytes) -> int:
    written = 0
    with zipfile.ZipFile(io.BytesIO(jar_bytes)) as zf:
        for rel in TEXTURES + GUI + ENVIRONMENT + ENTITY + PARTICLE:
            arc = f"assets/minecraft/textures/{rel}"
            dest = TEX_DIR / rel
            if dest.exists() and dest.stat().st_size > 0:
                continue
            try:
                data = zf.read(arc)
            except KeyError:
                print(f"  ! missing in jar: {arc}")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            written += 1
    return written


def fetch_sounds(index: dict) -> int:
    written = 0
    for rel in SOUNDS:
        dest = SOUND_DIR / rel
        if dest.exists() and dest.stat().st_size > 0:
            continue
        key = f"minecraft/sounds/{rel}"
        obj = index.get("objects", {}).get(key)
        if obj is None:
            print(f"  ! not in asset index: {key}")
            continue
        h = obj["hash"]
        url = f"{RESOURCE_BASE}{h[:2]}/{h}"
        try:
            data = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! failed {key}: {exc}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        written += 1
        print(f"  + {key}")
    return written


def main() -> int:
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    SOUND_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching version manifest ...")
    manifest = json.loads(fetch(VERSION_JSON_URL))
    asset_index = manifest.get("assetIndex") or {}
    index_bytes = fetch(asset_index["url"])
    index = json.loads(index_bytes)

    print("Fetching 1.8.8 client jar ...")
    jar_url = manifest["downloads"]["client"]["url"]
    jar_bytes = fetch(jar_url)
    n = extract_textures(jar_bytes)
    print(f"Extracted {n} new texture files")

    print("Fetching sounds ...")
    n = fetch_sounds(index)
    print(f"Downloaded {n} new sound files")
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
