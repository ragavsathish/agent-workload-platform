"""Add the model's complex per-band mask as a diagnostic ONNX output."""

# pyright: reportMissingImports=false

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import onnx
from onnx import TensorProto, helper

EXPECTED_OUTPUTS = ["frames", "h_out", "c_out"]
MASK_NODE_NAMES = [f"/Mul_{index}" for index in range(5, 161, 5)]


def instrument(model_path: Path) -> None:
    model = onnx.load(model_path)
    outputs = [output.name for output in model.graph.output]
    if outputs != EXPECTED_OUTPUTS:
        raise RuntimeError(f"unexpected VoxLock outputs: {outputs}")

    nodes = {node.name: node for node in model.graph.node}
    mask_outputs: list[str] = []
    for name in MASK_NODE_NAMES:
        node = nodes.get(name)
        if node is None or node.op_type != "Mul" or len(node.output) != 1:
            raise RuntimeError(f"VoxLock mask node is missing: {name}")
        mask_outputs.append(node.output[0])

    model.graph.node.append(
        helper.make_node(
            "Concat",
            inputs=mask_outputs,
            outputs=["diagnostic_mask"],
            name="VoiceDiagnosticsMaskConcat",
            axis=3,
        )
    )
    model.graph.output.append(
        helper.make_tensor_value_info(
            "diagnostic_mask",
            TensorProto.FLOAT,
            [1, 1, 2, 257, "K"],
        )
    )
    onnx.checker.check_model(model)
    onnx.save(model, model_path)

    provenance_path = model_path.parent / "provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["diagnosticInstrumentation"] = {
        "output": "diagnostic_mask",
        "sourceNodes": MASK_NODE_NAMES,
        "instrumentedSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
    }
    provenance_path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    instrument(Path(sys.argv[1]))
