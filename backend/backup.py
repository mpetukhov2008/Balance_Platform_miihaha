"""Consistent SQLite snapshots. Restore always creates a new database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify(path):
    path = Path(path)
    meta = json.loads(path.with_suffix(path.suffix + '.json').read_text())
    if digest(path) != meta['sha256']:
        raise ValueError('Backup checksum mismatch')
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('Backup integrity check failed')
    return meta


def create(source, directory, keep=7):
    source, directory = Path(source), Path(directory)
    if not source.is_file():
        raise ValueError('Source database does not exist')
    if keep < 1:
        raise ValueError('Retention must be positive')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle, temp = tempfile.mkstemp(dir=directory, prefix='.snapshot-', suffix='.db')
    os.close(handle)
    temp = Path(temp)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src, closing(sqlite3.connect(temp)) as dst:
            src.backup(dst)
        name = 'balance-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.db'
        target = directory / name
        temp.rename(target)
        target.chmod(0o600)
        metadata = target.with_suffix('.db.json')
        metadata.write_text(json.dumps({'sha256': digest(target), 'createdAt': datetime.now(timezone.utc).isoformat()}))
        metadata.chmod(0o600)
        verify(target)
        for old in sorted(directory.glob('balance-*.db'), reverse=True)[keep:]:
            old.unlink()
            old.with_suffix('.db.json').unlink(missing_ok=True)
        return target
    finally:
        temp.unlink(missing_ok=True)


def restore(source, target):
    source, target = Path(source), Path(target)
    verify(source)
    # Exclusive creation prevents overwriting an existing/live database.
    with target.open('xb') as stream:
        os.chmod(target, 0o600)
        with source.open('rb') as src:
            import shutil
            shutil.copyfileobj(src, stream)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    c = sub.add_parser('create')
    c.add_argument('source')
    c.add_argument('directory')
    c.add_argument('--keep', type=int, default=7)
    v = sub.add_parser('verify')
    v.add_argument('source')
    r = sub.add_parser('restore')
    r.add_argument('source')
    r.add_argument('target')
    args = parser.parse_args()
    if args.command == 'create':
        print(create(args.source, args.directory, args.keep))
    elif args.command == 'verify':
        verify(args.source)
        print('Backup verified')
    else:
        print(restore(args.source, args.target))


if __name__ == '__main__':
    main()
