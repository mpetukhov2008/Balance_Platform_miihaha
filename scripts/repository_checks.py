"""Reject tracked runtime files and high-confidence credential formats; never print values."""
from pathlib import Path
import re
import subprocess

root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode('utf-8').split('\0')
patterns=[re.compile(r'gh[pousr]_[A-Za-z0-9]{36,}'),
          re.compile(r'github_pat_[A-Za-z0-9_]{50,}'),
          re.compile(r'AKIA[0-9A-Z]{16}'),
          re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
problems=[]
checked=0
for name in filter(None,paths):
    file=root/name
    if not file.is_file():
        continue
    if file.name in ('.env','team-local.env') or name.startswith(('runtime/','node_modules/','.venv/')):
        problems.append(name+': runtime/secret file must not be tracked')
    try:
        content=file.read_text(encoding='utf-8-sig')
    except (UnicodeError,OSError):
        continue
    checked+=1
    if any(pattern.search(content) for pattern in patterns):
        problems.append(name+': possible credential; value redacted')
if problems:
    raise SystemExit('\n'.join(problems))
print(f'Repository checks passed: {checked} text files; no tracked runtime secrets or matched credential formats.')
