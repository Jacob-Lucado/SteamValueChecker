#!/usr/bin/env python3
"""Turn Nitro furni into files this hotel can use.

A release pack (its .nitro files, the Arcturus `items_base` SQL and the furnidata entries):

    import-nitro-furni.py <pack folder> <slug> "<catalog page name>" [--price N] [--header IMAGE]

A full catalog dump, taking only some furni and giving each furni line its own page:

    import-nitro-furni.py <folder> <slug> "<catalog page name>" --items-base items_base.sql \\
        --furnidata FurnitureData.json --catalog-items catalog_items.sql --groups groups.json

groups.json maps each classname to the page it goes on. Only those classnames are taken.

It writes retro/furni/<slug>/ with the bundles, their icons and furniture.sql, which the hotel applies on
boot: the furni, the catalog pages under Furni and one offer per item.
"""

import argparse
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FURNI_TAB = 2123951  # the Furni tab of the catalog (2129066 is its Builders Club twin)
PAGE_BASE = 1800000000  # pages added by imports

# Arcturus items_base columns, in the order releases usually dump them, for SQL without a CREATE TABLE.
ITEMS_BASE = ["id", "sprite_id", "public_name", "item_name", "type", "width", "length", "stack_height", "allow_stack",
              "allow_sit", "allow_lay", "allow_walk", "allow_gift", "allow_trade", "allow_recycle", "allow_marketplace_sell",
              "allow_inventory_stack", "interaction_type", "interaction_modes_count", "vending_ids", "multiheight",
              "customparams", "effect_id_male", "effect_id_female", "clothing_on_walk"]
CATALOG_ITEMS = ["id", "item_ids", "page_id", "catalog_name", "cost_credits", "cost_points", "points_type", "amount"]

# Arcturus interactions PlusEMU knows by the same name. Anything else becomes 'default'.
INTERACTIONS = {"default", "tent", "gate", "teleport", "vendingmachine", "dice", "bed", "trophy", "roller", "onewaygate",
                "water", "effect", "lowpool"}


def parse_tuple(body: str):
    token, quoted, i = "", False, 0
    while i < len(body):
        char = body[i]
        if quoted:
            if char == "\\" and i + 1 < len(body):
                token += body[i + 1]
                i += 1
            elif char == "'":
                if i + 1 < len(body) and body[i + 1] == "'":
                    token += "'"
                    i += 1
                else:
                    quoted = False
            else:
                token += char
        elif char == "'":
            quoted = True
        elif char == ",":
            yield token.strip()
            token = ""
        else:
            token += char
        i += 1
    yield token.strip()


def table(text: str, name: str, default_columns: list[str]) -> list[dict]:
    """The rows of every INSERT INTO `name`, by the CREATE TABLE's columns when the dump has one."""
    create = re.search(r"CREATE TABLE `%s`.*?\) ENGINE" % name, text, re.S)
    columns = re.findall(r"^\s+`([A-Za-z_]+)`", create.group(0), re.M) if create else default_columns
    rows = []
    for line in text.splitlines():
        if line.startswith(f"INSERT INTO `{name}` VALUES ("):
            rows.append(dict(zip(columns, parse_tuple(line[line.index("(") + 1:line.rindex(")")]))))
    return rows


def furnidata(text: str) -> dict[str, dict]:
    """Furnidata entries by classname, from a whole FurnitureData.json or a pack's fragment of it."""
    try:
        whole = json.loads(text)
        entries = [entry for kind in ("roomitemtypes", "wallitemtypes") for entry in whole.get(kind, {}).get("furnitype", [])]
    except json.JSONDecodeError:
        # Packs split floor and wall items with "## ... ##" notes; the entries themselves are what matter.
        body = re.sub(r"(?m)^\s*##.*##\s*$", "", text).strip().rstrip(",")
        body = body if body.startswith("{") else "{" + body
        entries = json.loads("[" + body + ("" if body.endswith("}") else "}") + "]")
    return {entry["classname"]: entry for entry in entries if "classname" in entry}


def readable(text: str, classname: str) -> str:
    """A furni's name. Some dumps carry text keys like `habbos_cf_coffebag_name` instead: then the
    classname, without its creator prefix and short codes, stands in."""
    if text and (" " in text or "_" not in text):
        return text
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z0-9])", " ", classname)
    words = [word for word in re.split(r"[_\s]+", spaced)[1:] if len(word) > 2 or word.isdigit()]
    return " ".join(word if word.isdigit() else word.capitalize() for word in words) or classname


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def first(folder: pathlib.Path, pattern: str, match=lambda path: True) -> pathlib.Path:
    found = [path for path in folder.rglob(pattern) if match(path)]
    if not found:
        sys.exit(f"Could not find {pattern} in {folder}")
    return found[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pack")
    parser.add_argument("slug")
    parser.add_argument("page")
    parser.add_argument("--price", type=int, default=None, help="credits per item; the source's own price when left out")
    parser.add_argument("--icon", type=int, default=176)
    parser.add_argument("--header", default="catalog_frontpage_headline_shop_EN")
    parser.add_argument("--items-base")
    parser.add_argument("--furnidata")
    parser.add_argument("--catalog-items")
    parser.add_argument("--groups", help="JSON of classname to page name; only these furni are taken")
    args = parser.parse_args()

    pack = pathlib.Path(args.pack)
    sql_path = pathlib.Path(args.items_base) if args.items_base else first(pack, "*SQL*.txt")
    data_path = pathlib.Path(args.furnidata) if args.furnidata else first(pack, "*.txt", lambda path: "data" in path.name.lower())
    catalog_path = pathlib.Path(args.catalog_items) if args.catalog_items else sql_path
    read = lambda path: path.read_text(encoding="utf-8", errors="replace")

    items = table(read(sql_path), "items_base", ITEMS_BASE)
    data = furnidata(read(data_path))
    prices = {}
    for offer in table(read(catalog_path), "catalog_items", CATALOG_ITEMS):
        for item_id in str(offer.get("item_ids", "")).split(";"):
            if item_id.strip().isdigit() and str(offer.get("cost_credits", "")).isdigit():
                prices.setdefault(item_id.strip(), (int(offer["cost_credits"]), int(offer.get("cost_points") or 0), int(offer.get("points_type") or 0)))

    groups = json.loads(read(pathlib.Path(args.groups))) if args.groups else None
    bundles = {path.stem: path for path in pack.rglob("*.nitro")}
    icons = {path.name[:-len("_icon.png")]: path for path in pack.rglob("*_icon.png")}

    # One row per classname: a dump can list a furni more than once (colors share a bundle).
    chosen = {}
    for item in items:
        name = item["item_name"]
        if (groups is None or name in groups) and name not in chosen:
            chosen[name] = item

    out = ROOT / "furni" / args.slug
    if out.exists():
        shutil.rmtree(out)
    (out / "bundles").mkdir(parents=True)
    (out / "icons").mkdir()

    first_id = int(next(iter(chosen.values()))["id"]) if chosen else 0
    parent_id = PAGE_BASE + first_id % 100000000
    lines = [f"-- {args.page}: made by tools/import-nitro-furni.py. Safe to run again.", "",
             "INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)",
             f"VALUES ({parent_id}, {FURNI_TAB}, {q(args.page)}, {args.icon}, NULL, -1, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);",
             f"INSERT IGNORE INTO catalog_page_images (page_id, slot, image) VALUES ({parent_id}, 0, {q(args.header)});", ""]
    page_of = {}
    if groups:
        for position, caption in enumerate(sorted(set(groups.values()))):
            page_of[caption] = parent_id + position + 1
            lines.append(f"INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level) "
                         f"VALUES ({page_of[caption]}, {parent_id}, {q(caption)}, {args.icon}, NULL, {position}, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);")
            lines.append(f"INSERT IGNORE INTO catalog_page_images (page_id, slot, image) VALUES ({page_of[caption]}, 0, {q(args.header)});")
        lines.append("")

    # Imported furni get their own id range, so they never meet a hotel's existing rows.
    id_base = parent_id - PAGE_BASE + 1100000000
    missing, written = [], 0
    for position, (name, item) in enumerate(chosen.items(), 1):
        bundle, entry = bundles.get(name), data.get(name)
        if bundle is None or entry is None:
            missing.append(name)
            continue
        shutil.copy(bundle, out / "bundles" / bundle.name)
        if name in icons:
            shutil.copy(icons[name], out / "icons" / icons[name].name)

        furni_id = id_base + position
        interaction = item.get("interaction_type", "default").lower()
        heights = item.get("multiheight", "0") if interaction == "multiheight" and item.get("multiheight") not in (None, "", "0") else "0"
        colors = ",".join(entry.get("partcolors", {}).get("color", []) or [])
        row = {
            "id": furni_id, "item_name": name, "public_name": readable(item.get("public_name", ""), name)[:56], "type": item["type"],
            "width": int(item["width"]), "length": int(item["length"]), "stack_height": float(item["stack_height"]),
            "can_stack": int(item["allow_stack"]), "can_sit": int(item["allow_sit"]), "is_walkable": int(item["allow_walk"]),
            "sprite_id": int(entry.get("id", item["sprite_id"])), "allow_recycle": int(item["allow_recycle"]), "allow_trade": int(item["allow_trade"]),
            "allow_marketplace_sell": int(item["allow_marketplace_sell"]), "allow_gift": int(item["allow_gift"]),
            "allow_inventory_stack": int(item["allow_inventory_stack"]), "interaction_type": interaction if interaction in INTERACTIONS else "default",
            "interaction_modes_count": int(item.get("interaction_modes_count") or 1), "vending_ids": item.get("vending_ids") or "0",
            "height_adjustable": heights.replace(";", ","), "effect_id": 0, "has_furnidata": 1,
            "revision": int(entry.get("revision", 0)), "category": entry.get("category", "unknown"),
            "default_dir": int(entry.get("defaultdir", 0)), "xdim": int(entry.get("xdim", 1)), "ydim": int(entry.get("ydim", 1)),
            "part_colors": colors or None, "name": readable(entry.get("name") or item.get("public_name", ""), name), "description": entry.get("description", ""),
            "ad_url": entry.get("adurl", ""), "excluded_dynamic": bool(entry.get("excludeddynamic")), "custom_params": entry.get("customparams", ""),
            "special_type": int(entry.get("specialtype", 1) or 1), "can_stand_on": bool(entry.get("canstandon")),
            "can_sit_on": bool(entry.get("cansiton")), "can_lay_on": bool(entry.get("canlayon")),
            "furni_line": entry.get("furniline", ""), "environment": entry.get("environment", ""), "rare": bool(entry.get("rare")),
        }
        page = page_of.get(groups[name], parent_id) if groups else parent_id
        credits, points, points_type = prices.get(str(item["id"]), (1, 0, 0))
        credits = args.price if args.price is not None else credits
        lines.append(f"INSERT IGNORE INTO furniture ({', '.join(row)}) VALUES ({', '.join(q(v) for v in row.values())});")
        lines.append(f"INSERT IGNORE INTO catalog_offers (id, localization_key, cost_credits, cost_points, points_type, club_level, bulk_purchase, enabled) "
                     f"VALUES ({furni_id}, {q(name)}, {credits}, {points}, {points_type}, 0, 1, 1);")
        # The offer points at the furni by name, so it still matches if the furni was added before under another id.
        lines.append(f"INSERT IGNORE INTO catalog_offer_products (offer_id, position, product_type, furniture_id, amount, extra_param) "
                     f"SELECT {furni_id}, 0, 'furni', id, 1, '' FROM furniture WHERE furnidata_classname = {q(name)};")
        lines.append(f"INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position) VALUES ({page}, {furni_id}, {position});")
        written += 1

    (out / "furniture.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{written} furni written to {out.relative_to(ROOT)}; page {parent_id}")
    if missing:
        print(f"skipped {len(missing)} (no bundle or furnidata):", ", ".join(missing[:20]), file=sys.stderr)


if __name__ == "__main__":
    main()
