from dataclasses import is_dataclass, asdict
import numpy as np


def clean_types(obj):
    """Recursively convert dataclass, numpy types, and nested structures to native Python types."""
    if is_dataclass(obj):
        return clean_types(asdict(obj))
    elif isinstance(obj, dict):
        return {clean_types(k): clean_types(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return type(obj)(clean_types(item) for item in obj)
    elif isinstance(obj, np.generic):
        return obj.item()
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    else:
        return obj
