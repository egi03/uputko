"""HALMED's database, downloaded on this computer and stored on the server.

HALMED does not serve some servers (connections from cloud addresses time out), so the server
runs with HALMED_DOWNLOAD=false and gets the database from a computer HALMED serves:

    uv run python scripts/push_halmed.py user@server

Downloads HALMED's result page and export as the daily job would (python -m
app.ingest.drugs_jobs --download-halmed), copies them into the backend container's
data/raw/halmed and stores them there with the lists already on the server (--from-raw).
Needs ssh and scp with a key for the server and sudo there for docker.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
FILES = ("results.html.gz", "halmed_export.xlsx")  # drugs_jobs.HALMED_PAGE, HALMED_EXPORT
RAW = "/app/backend/data/raw/halmed"  # the container's data/raw/halmed


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=cwd)  # noqa: S603 - our own commands, no shell


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("host", help="ssh destination of the server, e.g. user@203.0.113.10")
    parser.add_argument("--container", default="uputko-backend-1", help="backend container")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        run([sys.executable, "-m", "app.ingest.drugs_jobs", "--download-halmed", tmp], BACKEND)
        run(["scp", "-q", *(str(Path(tmp) / f) for f in FILES), f"{args.host}:"])  # its home
    c = args.container
    copy = " && ".join(f"sudo docker cp ~/{f} {c}:{RAW}/{f}" for f in FILES)
    remote = (
        f"sudo docker exec {c} mkdir -p {RAW} && {copy} && "
        f"sudo docker exec {c} python -m app.ingest.drugs_jobs --from-raw && "
        f"rm -f {' '.join('~/' + f for f in FILES)}"
    )
    run(["ssh", args.host, remote])
    print("HALMED stored on the server.")


if __name__ == "__main__":
    main()
