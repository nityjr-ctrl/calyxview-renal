#!/usr/bin/env python3
"""Load one checksum-verified Task135 fold without running patient inference."""

from __future__ import annotations

import argparse
import inspect
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-load one trusted nnU-Net fold.")
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--fold", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from nnunet.training import model_restore

    source = inspect.getsource(model_restore.load_model_and_checkpoint_files)
    if "weights_only=False" not in source:
        raise RuntimeError(
            "Audited explicit weights_only=False compatibility call is missing"
        )
    trainer, checkpoint_parameters = model_restore.load_model_and_checkpoint_files(
        str(args.model_directory),
        folds=[args.fold],
        mixed_precision=True,
        checkpoint_name="model_final_checkpoint",
    )
    state_dict = checkpoint_parameters[0].get("state_dict", {})
    print(
        json.dumps(
            {
                "status": "ok",
                "trainer": type(trainer).__name__,
                "fold": args.fold,
                "checkpoint_parameter_tensors": len(state_dict),
                "weights_only_explicitly_disabled": True,
                "trusted_archive_required": True,
                "checkpoint_loaded_to_gpu": False,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
