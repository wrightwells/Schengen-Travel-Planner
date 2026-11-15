"""Private file storage. Document bytes and metadata never enter the database."""

import json
import os
import re
import stat
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException

MAX_PROOF_BYTES = 10 * 1024 * 1024
MAX_PROOFS_PER_TRIP = 20
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC


def safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"[^a-zA-Z0-9 ._()-]", "_", name).strip(" .")[:150] or "travel-proof"


def document_type(content: bytes) -> str:
    if not content or len(content) > MAX_PROOF_BYTES:
        raise HTTPException(413, "Choose a non-empty document no larger than 10 MB")
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise HTTPException(415, "Only PDF, JPEG and PNG documents are supported")


def private_stat(fd: int, *, directory=False):
    info = os.fstat(fd)
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    mode = 0o700 if directory else 0o600
    if (
        not expected(info.st_mode)
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) != mode
        or (not directory and info.st_nlink != 1)
    ):
        raise OSError("Proof storage ownership or permissions are unsafe")


class ProofStorage:
    def __init__(self, path: str):
        self.path = Path(os.path.abspath(path))

    @contextmanager
    def trip_directory(self, trip_id: UUID, *, create=False):
        """Walk via directory descriptors; never follow symlinks, even in parent paths."""
        descriptors = []
        try:
            current = os.open("/", DIRECTORY_FLAGS)
            descriptors.append(current)
            for component in self.path.parts[1:]:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=current)
                except FileExistsError:
                    pass
                current = os.open(component, DIRECTORY_FLAGS, dir_fd=current)
                descriptors.append(current)
            private_stat(current, directory=True)
            name = str(trip_id)
            if create:
                try:
                    os.mkdir(name, mode=0o700, dir_fd=current)
                except FileExistsError:
                    pass
            try:
                trip = os.open(name, DIRECTORY_FLAGS, dir_fd=current)
            except FileNotFoundError:
                yield None
                return
            descriptors.append(trip)
            private_stat(trip, directory=True)
            yield trip
        except OSError:
            raise HTTPException(
                503, "Private proof storage is unavailable; contact the administrator"
            ) from None
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    @staticmethod
    def proof_names(directory: int) -> list[str]:
        return [
            name
            for name in os.listdir(directory)
            if re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.proof", name)
        ]

    @staticmethod
    def read(directory: int, proof_id: UUID, *, content=False):
        try:
            descriptor = os.open(f"{proof_id}.proof", FILE_FLAGS, dir_fd=directory)
        except FileNotFoundError:
            raise HTTPException(404, "Travel proof not found") from None
        with os.fdopen(descriptor, "rb") as stream:
            private_stat(stream.fileno())
            try:
                line = stream.readline(2048)
                metadata = json.loads(line)
                if (
                    not line.endswith(b"\n")
                    or metadata["id"] != str(proof_id)
                    or not isinstance(metadata["size"], int)
                    or not 0 < metadata["size"] <= MAX_PROOF_BYTES
                    or os.fstat(stream.fileno()).st_size != len(line) + metadata["size"]
                    or metadata["filename"] != safe_filename(metadata["filename"])
                    or metadata["media_type"] not in {"application/pdf", "image/png", "image/jpeg"}
                ):
                    raise ValueError("Invalid proof metadata")
                if content:
                    return metadata, stream.read(MAX_PROOF_BYTES + 1)
                return metadata
            except (ValueError, KeyError, TypeError, AttributeError):
                raise OSError("Invalid proof file") from None

    def list(self, trip_id: UUID) -> list[dict]:
        with self.trip_directory(trip_id) as directory:
            if directory is None:
                return []
            return sorted(
                [self.read(directory, UUID(name[:-6])) for name in self.proof_names(directory)],
                key=lambda item: item["uploaded_at"],
            )

    def save(self, trip_id: UUID, filename: str, content: bytes) -> dict:
        media_type = document_type(content)
        filename = safe_filename(filename)
        extensions = {
            "application/pdf": (".pdf",),
            "image/jpeg": (".jpg", ".jpeg"),
            "image/png": (".png",),
        }
        if not filename.lower().endswith(extensions[media_type]):
            raise HTTPException(415, "The filename must match the document type: PDF, JPEG or PNG")
        proof_id = uuid4()
        metadata = {
            "id": str(proof_id),
            "filename": filename,
            "size": len(content),
            "media_type": media_type,
            "uploaded_at": datetime.now(UTC).isoformat(),
        }
        with self.trip_directory(trip_id, create=True) as directory:
            if len(self.proof_names(directory)) >= MAX_PROOFS_PER_TRIP:
                raise HTTPException(409, "A history entry can have at most 20 travel proofs")
            temporary = f".upload-{uuid4()}"
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=directory,
            )
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    os.fchmod(stream.fileno(), 0o600)
                    stream.write(json.dumps(metadata).encode() + b"\n")
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.rename(
                    temporary, f"{proof_id}.proof", src_dir_fd=directory, dst_dir_fd=directory
                )
                os.fsync(directory)
            finally:
                try:
                    os.unlink(temporary, dir_fd=directory)
                except FileNotFoundError:
                    pass
        return metadata

    def download(self, trip_id: UUID, proof_id: UUID):
        with self.trip_directory(trip_id) as directory:
            if directory is None:
                raise HTTPException(404, "Travel proof not found")
            return self.read(directory, proof_id, content=True)

    def delete(self, trip_id: UUID, proof_id: UUID):
        with self.trip_directory(trip_id) as directory:
            if directory is None:
                raise HTTPException(404, "Travel proof not found")
            self.read(directory, proof_id)
            os.unlink(f"{proof_id}.proof", dir_fd=directory)
            os.fsync(directory)

    def delete_all(self, trip_id: UUID):
        with self.trip_directory(trip_id) as directory:
            if directory is not None:
                for name in self.proof_names(directory):
                    os.unlink(name, dir_fd=directory)
                os.fsync(directory)
