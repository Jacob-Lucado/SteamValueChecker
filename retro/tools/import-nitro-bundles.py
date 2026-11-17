#!/usr/bin/env python3
"""Add loose Nitro furni (just .nitro bundles, no SQL or furnidata) to the hotel.

    import-nitro-bundles.py <folder with .nitro files> <slug> "<catalog page name>" \\
        --have have.txt --db-names db.txt [--price 3]

have.txt lists the classnames the hotel already has art for, one per line. Those are skipped. db.txt lists
classnames that already have a furni row, so a bundle for one of them is copied as art only.

Each new bundle carries its own size and states, so the furni row comes from that. Names are made from the
classname. The page is split by classname prefix, at most PAGE_SIZE furni per page. It writes
retro/furni/<slug>/ with bundles, icons and furniture.sql.
"""

import argparse
import collections
import json
import pathlib
import re
import shutil
import struct
import gzip
import zlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
FURNI_TAB = 2123951
PAGE_BASE = 1850000000
ID_BASE = 1400000000
PAGE_SIZE = 100
MIN_GROUP = 6


def load(path: pathlib.Path) -> dict[str, bytes]:
    data = path.read_bytes()
    count = struct.unpack(">H", data[:2])[0]
    offset, files = 2, {}
    for _ in range(count):
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        name = data[offset + 2:offset + 2 + length].decode()
        offset += 2 + length
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        offset += 4
        blob = data[offset:offset + size]
        files[name] = gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else zlib.decompress(blob)
        offset += size
    return files


def pack(files: dict[str, bytes]) -> bytes:
    # The client reads zlib; some bundles ship gzip, so every bundle is written back as zlib.
    out = struct.pack(">H", len(files))
    for name, blob in files.items():
        raw = name.encode()
        packed = zlib.compress(blob, 9)
        out += struct.pack(">H", len(raw)) + raw + struct.pack(">I", len(packed)) + packed
    return out


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def words(classname: str) -> list[str]:
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z0-9])", " ", classname)
    return [w for w in re.split(r"[_\s]+", spaced) if w]


def readable(classname: str) -> str:
    parts = words(classname)
    return " ".join(w if w.isdigit() else w.capitalize() for w in parts)[:56] or classname


def icon(files: dict[str, bytes], name: str, target: pathlib.Path) -> bool:
    try:
        meta = json.loads(files[f"{name}.json"])
        frames = meta["spritesheet"]["frames"]
        key = next(k for k in frames if k.endswith("_icon_a"))
        frame = frames[key]
        sheet = Image.open(__import__("io").BytesIO(files[f"{name}.png"])).convert("RGBA")
        box = frame["frame"]
        crop = sheet.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]))
        full = frame["sourceSize"]
        canvas = Image.new("RGBA", (full["w"], full["h"]))
        place = frame["spriteSourceSize"]
        canvas.paste(crop, (place["x"], place["y"]))
        canvas.save(target)
        return True
    except (KeyError, StopIteration, ValueError, OSError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("slug")
    parser.add_argument("page")
    parser.add_argument("--have", required=True)
    parser.add_argument("--db-names", required=True)
    parser.add_argument("--price", type=int, default=3)
    parser.add_argument("--icon", type=int, default=176)
    parser.add_argument("--header", default="catalog_frontpage_headline_shop_EN")
    args = parser.parse_args()

    have = set(pathlib.Path(args.have).read_text().split())
    known = set(pathlib.Path(args.db_names).read_text().split())
    bundles = sorted(pathlib.Path(args.folder).glob("*.nitro"))

    out = ROOT / "furni" / args.slug
    if out.exists():
        shutil.rmtree(out)
    (out / "bundles").mkdir(parents=True)
    (out / "icons").mkdir()

    fresh, art_only, skipped = [], 0, []
    for path in bundles:
        name = path.stem
        if name in have:
            continue
        try:
            files = load(path)
            if name in known:
                (out / "bundles" / path.name).write_bytes(pack(files))
                art_only += 1
                continue
            meta = json.loads(files[f"{name}.json"])
            dims = meta["logic"]["model"]["dimensions"]
            (out / "bundles" / path.name).write_bytes(pack(files))
        except (KeyError, ValueError, struct.error, zlib.error, OSError):
            skipped.append(name)
            continue
        states = 1
        if meta.get("logicType") == "furniture_multistate":
            largest = max((v.get("animations", {}) for v in meta.get("visualizations", []) if v.get("size") == 64), key=len, default={})
            states = max(len(largest), 2)
        has_icon = icon(files, name, out / "icons" / f"{name}_icon.png")
        fresh.append((name, dims, states, has_icon))

    groups = collections.defaultdict(list)
    for item in fresh:
        groups[(words(item[0]) or [item[0]])[0].lower()].append(item)
    pages = collections.defaultdict(list)
    for prefix, items in sorted(groups.items()):
        pages[prefix if len(items) >= MIN_GROUP else "misc"].extend(items)

    parent = PAGE_BASE
    lines = [f"-- {args.page}: made by tools/import-nitro-bundles.py. Safe to run again.", "",
             "INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)",
             f"VALUES ({parent}, {FURNI_TAB}, {q(args.page)}, {args.icon}, NULL, -1, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);",
             f"INSERT IGNORE INTO catalog_page_images (page_id, slot, image) VALUES ({parent}, 0, {q(args.header)});", ""]
    page_id, furni_id, position = parent, ID_BASE, 0
    for key in sorted(pages, key=lambda k: (k == "misc", k)):
        items = sorted(pages[key])
        for chunk_index in range(0, len(items), PAGE_SIZE):
            chunk = items[chunk_index:chunk_index + PAGE_SIZE]
            page_id += 1
            position += 1
            caption = key.capitalize() + (f" {chunk_index // PAGE_SIZE + 1}" if len(items) > PAGE_SIZE else "")
            lines.append(f"INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level) "
                         f"VALUES ({page_id}, {parent}, {q(caption)}, {args.icon}, NULL, {position}, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);")
            lines.append(f"INSERT IGNORE INTO catalog_page_images (page_id, slot, image) VALUES ({page_id}, 0, {q(args.header)});")
            for slot, (name, dims, states, _) in enumerate(chunk, 1):
                furni_id += 1
                row = {
                    "id": furni_id, "item_name": name, "public_name": readable(name), "type": "s",
                    "width": int(dims["x"]), "length": int(dims["y"]), "stack_height": float(dims.get("z", 1)),
                    "can_stack": 1, "can_sit": 0, "is_walkable": 0, "sprite_id": furni_id, "allow_recycle": 0, "allow_trade": 1,
                    "allow_marketplace_sell": 0, "allow_gift": 1, "allow_inventory_stack": 1, "interaction_type": "default",
                    "interaction_modes_count": states, "vending_ids": "0", "height_adjustable": "0", "effect_id": 0, "has_furnidata": 1,
                    "revision": 59005, "category": "unknown", "default_dir": 0, "xdim": int(dims["x"]), "ydim": int(dims["y"]),
                    "part_colors": None, "name": readable(name), "description": "", "ad_url": "", "excluded_dynamic": False,
                    "custom_params": "", "special_type": 1, "can_stand_on": False, "can_sit_on": False, "can_lay_on": False,
                    "furni_line": "", "environment": "", "rare": False,
                }
                lines.append(f"INSERT IGNORE INTO furniture ({', '.join(row)}) VALUES ({', '.join(q(v) for v in row.values())});")
                lines.append(f"INSERT IGNORE INTO catalog_offers (id, localization_key, cost_credits, cost_points, points_type, club_level, bulk_purchase, enabled) "
                             f"VALUES ({furni_id}, {q(name)}, {args.price}, 0, 0, 0, 1, 1);")
                lines.append(f"INSERT IGNORE INTO catalog_offer_products (offer_id, position, product_type, furniture_id, amount, extra_param) "
                             f"SELECT {furni_id}, 0, 'furni', id, 1, '' FROM furniture WHERE furnidata_classname = {q(name)};")
                lines.append(f"INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position) VALUES ({page_id}, {furni_id}, {slot});")
    (out / "furniture.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if skipped:
        print("skipped (unreadable or no logic):", len(skipped), ", ".join(skipped[:15]))
    print(f"{len(fresh)} new furni on {len(set(l.split(',')[0] for l in lines if l.startswith('INSERT IGNORE INTO catalog_pages')))-1} pages, {art_only} art-only bundles -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
