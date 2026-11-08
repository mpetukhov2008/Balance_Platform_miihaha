"""Validate paired JSON archives without extracting any user-controlled paths."""
import io
import json
import math
import stat
import zipfile
import zlib
from pathlib import PurePosixPath

from backend.security import number


class UploadError(ValueError):
    pass


def options():
    return {
        "maxArchiveBytes": number("MAX_DATASET_ARCHIVE_BYTES", 32 * 1024 * 1024),
        "maxExpandedBytes": number("MAX_DATASET_EXPANDED_BYTES", 64 * 1024 * 1024),
        "maxPairs": number("MAX_DATASET_PAIRS", 20000),
        "maxDatasets": number("MAX_DATASETS_PER_USER", 5),
    }


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise UploadError("JSON содержит повторяющиеся ключи.")
        result[key] = value
    return result


def _constant(value):
    raise UploadError("JSON содержит недопустимое число: " + value)


def _float(value):
    result = float(value)
    if not math.isfinite(result):
        raise UploadError("JSON содержит число вне допустимого диапазона.")
    return result


def parse_archive(content):
    limits = options()
    if len(content) > limits["maxArchiveBytes"]:
        raise UploadError("Архив превышает допустимый размер.")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > limits["maxPairs"] * 2 + 100:
                raise UploadError("В архиве слишком много файлов.")
            total = sum(entry.file_size for entry in entries)
            if total > limits["maxExpandedBytes"]:
                raise UploadError("Распакованный датасет превышает допустимый размер.")
            pairs, roots = {}, set()
            aliases = {"BEFORE": "BEFORE", "AFTER": "AFTER", "BEFORE_MASTER": "BEFORE", "AFTER_BETA": "AFTER"}
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if (path.is_absolute() or "\\" in entry.filename or ":" in entry.filename
                        or any(part in (".", "..") for part in entry.filename.split("/"))
                        or stat.S_ISLNK(entry.external_attr >> 16)):
                    raise UploadError("Архив содержит недопустимый путь или символическую ссылку.")
                if entry.flag_bits & 1:
                    raise UploadError("Архив с паролем не поддерживается.")
                if entry.is_dir() or path.suffix.lower() != ".json" or "__MACOSX" in path.parts:
                    continue
                if len(path.parts) < 2 or path.parts[-2] not in aliases:
                    raise UploadError("JSON должны находиться в папках BEFORE/AFTER или BEFORE_MASTER/AFTER_BETA.")
                roots.add(path.parts[:-2])
                if len(roots) != 1:
                    raise UploadError("Архив должен содержать один датасет с общей родительской папкой.")
                app_id, side = path.stem, aliases[path.parts[-2]]
                if not app_id or len(app_id) > 128:
                    raise UploadError("Идентификатор заявки в имени файла должен содержать от 1 до 128 символов.")
                pair = pairs.setdefault(app_id, {})
                if side in pair:
                    raise UploadError("Повторяется файл заявки " + app_id + " на стороне " + side + ".")
                # Limit actual bytes read as well as sizes declared in the ZIP directory.
                with archive.open(entry) as stream:
                    raw = stream.read(min(limits["maxExpandedBytes"], 8 * 1024 * 1024) + 1)
                if len(raw) > min(limits["maxExpandedBytes"], 8 * 1024 * 1024):
                    raise UploadError("Один JSON-файл превышает допустимый размер (до 8 МиБ).")
                try:
                    document = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_object, parse_constant=_constant, parse_float=_float)
                    # Escaped unpaired surrogates otherwise fail later in worker/SQL encoding.
                    json.dumps(document, ensure_ascii=False, allow_nan=False).encode('utf-8')
                except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
                    if isinstance(exc, UploadError):
                        raise
                    raise UploadError("Некорректный JSON UTF-8 в файле " + entry.filename + ".") from None
                if (not isinstance(document, dict) or not isinstance(document.get("appData"), dict)
                        or document["appData"].get("application_id") != app_id):
                    raise UploadError("Имя файла должно совпадать с appData.application_id: " + entry.filename + ".")
                pair[side] = document
            if not pairs:
                raise UploadError("В архиве нет парных JSON-файлов.")
            if len(pairs) > limits["maxPairs"]:
                raise UploadError("Превышено допустимое число пар заявок.")
            missing = [app_id for app_id, pair in pairs.items() if set(pair) != {"BEFORE", "AFTER"}]
            if missing:
                raise UploadError("Для каждой заявки нужны обе версии. Нет пары для: " + ", ".join(sorted(missing)[:5]) + ".")
            return pairs, total
    except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error, UnicodeError) as exc:
        raise UploadError("Не удалось прочитать ZIP-архив. Проверьте формат и целостность файла.") from exc
