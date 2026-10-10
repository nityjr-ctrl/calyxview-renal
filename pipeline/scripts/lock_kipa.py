"""Verify a downloaded upstream model, arrange its runtime layout, freeze file hashes."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import zipfile
import tarfile

REV = "14a336e20101e474204efc308106bae503431dcb"
CHECKSUM = "fb22a9730070fdf45ed3923b1d82b4d2"
SOURCE_SHA256 = "4249bbd5b1febe28b9db2cb106a9a94a1a63dd6abb4ab01022a1b522acb270fd"


def digest(path, algorithm="sha256"):
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024): result.update(block)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        raise FileExistsError("Preserve existing locks; choose a fresh output file")
    if digest(args.archive, "md5") != CHECKSUM:
        raise ValueError("Published KiPA22 archive checksum mismatch")
    if digest(args.source_archive) != SOURCE_SHA256:
        raise ValueError("Source archive differs from the qualified pinned download; requalify explicitly")
    source_files = {p.relative_to(args.source).as_posix(): digest(p) for p in sorted(args.source.rglob("*.py"))}
    published = {}
    with tarfile.open(args.source_archive) as source_archive:
        for member in source_archive.getmembers():
            parts = Path(member.name).parts
            if member.isfile() and len(parts) > 2 and parts[1] == "nnUNet" and member.name.endswith(".py"):
                published[Path(*parts[2:]).as_posix()] = hashlib.sha256(source_archive.extractfile(member).read()).hexdigest()
    if not published or published != source_files:
        raise ValueError("Runtime Python source differs from the downloaded pinned source archive")
    if any((parent / ".git").exists() for parent in [args.results.resolve(), *args.results.resolve().parents]):
        raise ValueError("Model weights must stay outside Git")
    target = args.results / "nnUNet/3d_fullres/Task1001_KiPA22/BANetV2Trainer_1000Epoch__nnUNetPlans_FabiansResUNet_v2.1"
    with zipfile.ZipFile(args.archive) as archive:
        for info in archive.infolist():
            if info.is_dir() or not info.filename.startswith("BA-Net/"): continue
            relative = Path(info.filename).relative_to("BA-Net")
            path = (target / relative).resolve()
            if not path.is_relative_to(target.resolve()): raise ValueError("Unsafe archive path")
            if path.exists(): raise FileExistsError("Preserve existing weights; choose a fresh results folder")
            path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, path.open("wb") as dest: shutil.copyfileobj(src, dest)
    record = {"sourceRevision": REV, "archiveMd5": CHECKSUM, "archiveSha256": digest(args.archive),
              "sourceArchiveSha256": digest(args.source_archive), "sourceFiles": source_files,
              "weightFiles": {p.relative_to(args.results).as_posix(): digest(p) for p in sorted(target.rglob("*")) if p.is_file()}}
    args.out.write_text(json.dumps(record, indent=2))
    print("Published archive verified; source and BA-Net checkpoint hashes frozen")


if __name__ == "__main__": main()
