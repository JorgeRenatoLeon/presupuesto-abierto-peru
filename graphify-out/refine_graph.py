import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
GRAPH_PATH = Path(__file__).with_name("graph.json")
REPORT_PATH = Path(__file__).with_name("GRAPH_REPORT.md")

DIRECT_CALLS = {
    ("pipeline_run_main", "pipeline_aggregate_aggregate"),
    ("pipeline_run_main", "pipeline_alerts_compute_alerts"),
    ("pipeline_download_catalog", "pipeline_config_candidate_files"),
    ("pipeline_download_catalog", "pipeline_config_ingreso_candidate_files"),
    ("pipeline_run_main", "pipeline_download_catalog"),
    ("pipeline_run_main", "pipeline_download_download"),
    ("pipeline_run_main", "pipeline_normalize_normalize"),
    ("pipeline_run_main", "pipeline_normalize_normalize_ingreso"),
    ("pipeline_run_main", "pipeline_qa_qa"),
    ("pipeline_run_main", "pipeline_validate_validate"),
    ("pipeline_run_main", "pipeline_validate_validate_ingreso"),
}

PRIMITIVE_LABELS = {"int", "str", "bool", "float"}


def source_line(edge_or_node):
    source_file = edge_or_node.get("source_file")
    location = edge_or_node.get("source_location") or ""
    match = re.search(r"L(\d+)", location)
    if not source_file or not match:
        return None
    path = ROOT / source_file
    if not path.exists():
        return None
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    index = int(match.group(1)) - 1
    return lines[index].strip() if 0 <= index < len(lines) else None


def clean_source_text(text):
    text = re.sub(r"^\s*(#|//|/\*+|\*+|\*/)", "", text).strip()
    text = text.strip("`\"'")
    return re.sub(r"\s+", " ", text)


def repair_rationale_labels(nodes):
    for node in nodes:
        if node.get("file_type") != "rationale":
            continue
        line = source_line(node)
        if not line:
            continue
        line = clean_source_text(line)
        if len(line) > len(node.get("label", "")) or node["label"].endswith(("...", "S", "a")):
            node["label"] = line[:220].rstrip(" ,;:")


def refine_graph():
    graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
    nodes = graph["nodes"]
    links = graph["links"]

    for link in links:
        pair = (link.get("source"), link.get("target"))
        if link.get("relation") == "calls" and pair in DIRECT_CALLS:
            link["confidence"] = "EXTRACTED"
            link["confidence_score"] = 1.0
            link["context"] = "direct_call_verified"
        if pair == ("docs_data_dictionary", "budget_phase_semantics"):
            link["relation"] = "references"
            link["context"] = "defines_budget_semantics"
        elif pair == ("app_icon", "peru_currency_icon"):
            link["relation"] = "references"
            link["context"] = "depicts_visual_asset"

    primitive_ids = {
        node["id"] for node in nodes if node.get("label", "").lower() in PRIMITIVE_LABELS
    }
    graph["nodes"] = [node for node in nodes if node["id"] not in primitive_ids]
    graph["links"] = [
        link
        for link in links
        if link.get("source") not in primitive_ids and link.get("target") not in primitive_ids
    ]
    repair_rationale_labels(graph["nodes"])
    graph["directed"] = True
    graph["graph"]["directed"] = True
    graph["graph"]["refinement"] = {
        "direct_calls_verified": len(DIRECT_CALLS),
        "primitive_nodes_removed": sorted(primitive_ids),
        "semantic_edges_refined": 2,
    }
    GRAPH_PATH.write_text(json.dumps(graph, indent=2, ensure_ascii=False), encoding="utf-8")
    write_report(graph)
    print(f"Refined graph: {len(graph['nodes'])} nodes, {len(graph['links'])} links")
    print(f"Removed primitive nodes: {len(primitive_ids)}")


def write_report(graph):
    nodes = {node["id"]: node for node in graph["nodes"]}
    degree = Counter()
    for link in graph["links"]:
        degree[link["source"]] += 1
        degree[link["target"]] += 1
    god_nodes = [
        f"- `{nodes[node_id]['label']}` - {count} connections"
        for node_id, count in degree.most_common(10)
    ]
    inferred = [link for link in graph["links"] if link.get("confidence") != "EXTRACTED"]
    relation_counts = Counter(link.get("relation") for link in graph["links"])
    report = [
        "# Graphify Report", "", "## Summary",
        f"- Nodes: {len(graph['nodes'])}",
        f"- Relationships: {len(graph['links'])}",
        f"- Remaining inferred relationships: {len(inferred)}",
        "- Refinement: verified direct calls, semantic edge taxonomy, primitive filtering, rationale labels.",
        "", "## God Nodes", *god_nodes, "", "## Relationship Types",
        *[f"- `{relation}`: {count}" for relation, count in sorted(relation_counts.items())],
        "", "## Refinements Applied",
        "- 11 direct pipeline calls promoted to `EXTRACTED` with confidence score `1.0`.",
        "- Data dictionary semantics and icon depiction represented as contextual `references` edges.",
        "- Primitive type-only nodes and their edges removed; meaningful external types retained.",
        "- Rationale labels refreshed from source locations where available.",
        "", "## Suggested Questions",
        "- How does `pipeline_run_main` orchestrate download, normalization, aggregation, alerts, validation, and QA?",
        "- Which concepts connect the ETL pipeline to the citizen-facing web application?",
        "- Which remaining cross-community relationships are inferred rather than directly extracted?",
    ]
    REPORT_PATH.write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    refine_graph()