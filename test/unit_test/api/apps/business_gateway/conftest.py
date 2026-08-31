#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import importlib
import sys
import uuid
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest


@pytest.fixture
def gateway_modules():
    """Load Gateway modules without executing the global api.apps bootstrap."""

    root = Path(__file__).resolve().parents[5]
    source = root / "api" / "apps" / "business_gateway"
    package_name = f"_business_gateway_unit_{uuid.uuid4().hex}"
    spec = spec_from_file_location(package_name, source / "__init__.py", submodule_search_locations=[str(source)])
    assert spec is not None and spec.loader is not None
    package = module_from_spec(spec)
    sys.modules[package_name] = package
    spec.loader.exec_module(package)

    def load(name: str):
        return importlib.import_module(f"{package_name}.{name}")

    load.package_name = package_name

    try:
        yield load
    finally:
        for name in tuple(sys.modules):
            if name == package_name or name.startswith(f"{package_name}."):
                sys.modules.pop(name, None)
