from __future__ import annotations

import argparse
from pathlib import Path

from pyshacl import validate
from rdflib import Graph


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate digital-twin Turtle with SHACL")
    parser.add_argument("data", type=Path, help="Directory containing Turtle data files")
    parser.add_argument("--shapes", type=Path, action="append", required=True, help="SHACL Turtle file; may be repeated")
    parser.add_argument("--vocabulary", type=Path, action="append", default=[], help="Vocabulary Turtle file; may be repeated")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    graph = Graph()
    for path in args.vocabulary:
        graph.parse(path, format="turtle")
    paths = sorted(args.data.glob("*.ttl")) if args.data.is_dir() else [args.data]
    if not paths:
        raise SystemExit(f"No Turtle files found under {args.data}")
    for path in paths:
        graph.parse(path, format="turtle")

    shapes = Graph()
    for path in args.shapes:
        shapes.parse(path, format="turtle")
    conforms, _results_graph, report = validate(
        data_graph=graph,
        shacl_graph=shapes,
        inference="none",
        abort_on_first=False,
        allow_infos=False,
        allow_warnings=False,
    )
    if not conforms:
        print(report)
        return 1
    print(f"PASS  SHACL validated {len(graph)} triples from {len(paths)} Turtle files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
