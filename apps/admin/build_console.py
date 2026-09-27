#!/usr/bin/env python3
"""Inline queue.json into the console template.

The console is a single self-contained file so it can be opened without a
server, reviewed by someone non-technical, and shared. The production
console reads the same shape from `/v1/runs/{id}` instead.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).parent

template = (HERE / "console_demo.template.html").read_text()
data = json.loads((HERE / "queue.json").read_text())

out = template.replace("/*__QUEUE__*/", json.dumps(data, ensure_ascii=False))
if "__QUEUE__" in out:
    raise SystemExit("placeholder not substituted")

(HERE / "console_demo.html").write_text(out)
print(f"console_demo.html — {len(out):,} bytes, {len(data['cases'])} cases")
