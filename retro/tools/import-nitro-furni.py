#!/usr/bin/env python3
"""Turn a Nitro furni pack into files this hotel can use.

    import-nitro-furni.py <pack folder> <slug> "<catalog page name>" [--price N] [--icon N] [--header IMAGE]

The pack needs the usual release layout: .nitro files, the Arcturus `items_base` SQL and the furnidata
entries. It writes retro/furni/<slug>/ with the bundles, their icons and furniture.sql, which the hotel
applies on boot: the furni, a catalog page under Furni and one offer per item.
"""

import argparse
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FURNI_TAB = 2123951  # the Furni tab of the catalog (2129066 is its Builders Club twin)
PAGE_BASE = 1800000000  # pages added by packs; one per pack, numbered by its first furni id

# Arcturus items_base columns, in order.
ITEMS_BASE = ["id", "sprite_id", "public_name", "item_name", "type", "width", "length", "stack_height", "allow_stack",
              "allow_sit", "allow_lay", "allow_walk", "allow_gift", "allow_trade", "allow_recycle", "allow_marketplace_sell",
              "allow_inventory_stack", "interaction_type", "interaction_modes_count", "vending_ids", "multiheight",
              "customparams", "effect_id_male", "effect_id_female", "clothing_on_walk"]

# Arcturus interactions PlusEMU knows under another name. Anything unknown becomes 'default'.
INTERACTIONS = {"default": "default", "multiheight": "default", "tent": "tent", "gate": "gate", "teleport": "teleport",
                "vendingmachine": "vendingmachine", "dice": "dice", "bed": "bed", "trophy": "trophy", "roller": "roller",
                "onewaygate": "onewaygate", "water": "water", "effect": "effect", "lowpool": "lowpool"}


def sql_values(text: str) -> list[list]:
    """The value tuples of every INSERT INTO `items_base` statement."""
    rows = []
    for line in text.splitlines():
        if not line.startswith("INSERT INTO `items_base`"):
            continue
        body = line[line.index("(") + 1:line.rindex(")")]
        rows.append([value for value in parse_tuple(body)])
    return rows


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


def furnidata(text: str) -> dict[str, dict]:
    """Furnidata entries by classname, from a fragment of the JSON furnidata."""
    # Packs split floor and wall items with "## ... ##" notes; the entries themselves are what matter.
    body = re.sub(r"(?m)^\s*##.*##\s*$", "", text).strip().rstrip(",")
    body = body if body.startswith("{") else "{" + body
    entries = json.loads("[" + body + ("" if body.endswith("}") else "}") + "]")
    return {entry["classname"]: entry for entry in entries if "classname" in entry}


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pack")
    parser.add_argument("slug")
    parser.add_argument("page")
    parser.add_argument("--price", type=int, default=None, help="credits per item; the pack's own price when left out")
    parser.add_argument("--icon", type=int, default=176)
    parser.add_argument("--header", default="catalog_frontpage_headline_shop_EN")
    args = parser.parse_args()

    pack = pathlib.Path(args.pack)
    sql_file = next(pack.rglob("*SQL*.txt"))
    data_file = next(path for path in pack.rglob("*.txt") if "data" in path.name.lower())
    items = [dict(zip(ITEMS_BASE, row)) for row in sql_values(sql_file.read_text(encoding="utf-8", errors="replace"))]
    data = furnidata(data_file.read_text(encoding="utf-8", errors="replace"))
    prices = {}
    for match in re.finditer(r"INSERT INTO `catalog_items` VALUES \((\d+), '[^']*', \w+, '(?:[^']|'')*', (\d+), (\d+), (\d+)", sql_file.read_text(encoding="utf-8", errors="replace")):
        prices[int(match[1])] = (int(match[2]), int(match[3]), int(match[4]))

    out = ROOT / "furni" / args.slug
    if out.exists():
        shutil.rmtree(out)
    (out / "bundles").mkdir(parents=True)
    (out / "icons").mkdir()

    page_id = PAGE_BASE + int(items[0]["id"]) % 100000000
    lines = [f"-- {args.page}: made by tools/import-nitro-furni.py. Safe to run again.", "",
             f"INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)",
             f"VALUES ({page_id}, {FURNI_TAB}, {q(args.page)}, {args.icon}, NULL, -1, '', 'default_3x3', 'normal', 1, 1, 0);",
             f"INSERT IGNORE INTO catalog_page_images (page_id, slot, image) VALUES ({page_id}, 0, {q(args.header)});", ""]
    missing = []
    for position, item in enumerate(items, 1):
        name = item["item_name"]
        bundle = next(pack.rglob(f"{name}.nitro"), None)
        entry = data.get(name)
        if bundle is None or entry is None:
            missing.append(name)
            continue
        shutil.copy(bundle, out / "bundles" / bundle.name)
        icon = next(pack.rglob(f"{name}_icon.png"), None)
        if icon:
            shutil.copy(icon, out / "icons" / icon.name)

        furni_id = int(item["id"])
        interaction = INTERACTIONS.get(item["interaction_type"].lower(), "default")
        heights = item["multiheight"] if item["interaction_type"].lower() == "multiheight" and item["multiheight"] not in ("", "0") else "0"
        colors = ",".join(entry.get("partcolors", {}).get("color", []) or [])
        row = {
            "id": furni_id, "item_name": name, "public_name": item["public_name"][:56], "type": item["type"],
            "width": int(item["width"]), "length": int(item["length"]), "stack_height": float(item["stack_height"]),
            "can_stack": int(item["allow_stack"]), "can_sit": int(item["allow_sit"]), "is_walkable": int(item["allow_walk"]),
            "sprite_id": int(item["sprite_id"]), "allow_recycle": int(item["allow_recycle"]), "allow_trade": int(item["allow_trade"]),
            "allow_marketplace_sell": int(item["allow_marketplace_sell"]), "allow_gift": int(item["allow_gift"]),
            "allow_inventory_stack": int(item["allow_inventory_stack"]), "interaction_type": interaction,
            "interaction_modes_count": int(item["interaction_modes_count"] or 1), "vending_ids": item["vending_ids"] or "0",
            "height_adjustable": heights.replace(";", ","), "effect_id": 0, "has_furnidata": 1,
            "revision": int(entry.get("revision", 0)), "category": entry.get("category", "unknown"),
            "default_dir": int(entry.get("defaultdir", 0)), "xdim": int(entry.get("xdim", 1)), "ydim": int(entry.get("ydim", 1)),
            "part_colors": colors or None, "name": entry.get("name", item["public_name"]), "description": entry.get("description", ""),
            "ad_url": entry.get("adurl", ""), "excluded_dynamic": bool(entry.get("excludeddynamic")), "custom_params": entry.get("customparams", ""),
            "special_type": int(entry.get("specialtype", 1) or 1), "can_stand_on": bool(entry.get("canstandon")),
            "can_sit_on": bool(entry.get("cansiton")), "can_lay_on": bool(entry.get("canlayon")),
            "furni_line": entry.get("furniline", ""), "environment": entry.get("environment", ""), "rare": bool(entry.get("rare")),
        }
        lines.append(f"INSERT IGNORE INTO furniture ({', '.join(row)}) VALUES ({', '.join(q(v) for v in row.values())});")
        credits, points, points_type = prices.get(furni_id, (1, 0, 0))
        credits = args.price if args.price is not None else credits
        lines.append(f"INSERT IGNORE INTO catalog_offers (id, localization_key, cost_credits, cost_points, points_type, club_level, bulk_purchase, enabled) "
                     f"VALUES ({furni_id}, {q(name)}, {credits}, {points}, {points_type}, 0, 1, 1);")
        lines.append(f"INSERT IGNORE INTO catalog_offer_products (offer_id, position, product_type, furniture_id, amount, extra_param) "
                     f"VALUES ({furni_id}, 0, 'furni', {furni_id}, 1, '');")
        lines.append(f"INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position) VALUES ({page_id}, {furni_id}, {position});")

    (out / "furniture.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(items) - len(missing)} furni written to {out.relative_to(ROOT)}; page {page_id}")
    if missing:
        print("skipped (no bundle or furnidata):", ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    main()
