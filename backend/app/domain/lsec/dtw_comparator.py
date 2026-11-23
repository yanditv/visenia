import math

import numpy as np


def dtw_distance(reference: np.ndarray, candidate: np.ndarray, band_ratio: float = 0.2) -> dict:

    n = len(reference)
    m = len(candidate)

    if n == 0 or m == 0:
        raise ValueError("Secuencia vacia.")

    if reference.shape[1] != candidate.shape[1]:
        raise ValueError("Las caracteristicas no coinciden.")

    band = max(abs(n - m), math.ceil(max(n, m) * band_ratio))

    costs = np.full((n + 1, m + 1), np.inf, dtype=np.float64)

    lengths = np.zeros((n + 1, m + 1), dtype=np.int32)

    costs[0, 0] = 0.0

    for i in range(1, n + 1):
        j_min = max(1, i - band)
        j_max = min(m, i + band)
        distances = np.linalg.norm(reference[i - 1] - candidate[j_min - 1 : j_max], axis=1)

        for j, distance in enumerate(distances, start=j_min):
            above = costs[i - 1, j]
            left = costs[i, j - 1]
            diagonal = costs[i - 1, j - 1]
            # Preserve the predecessor order on ties.
            if above <= left and above <= diagonal:
                best_i, best_j = i - 1, j
            elif left <= diagonal:
                best_i, best_j = i, j - 1
            else:
                best_i, best_j = i - 1, j - 1

            if not np.isfinite(costs[best_i, best_j]):
                continue

            costs[i, j] = distance + costs[best_i, best_j]

            lengths[i, j] = lengths[best_i, best_j] + 1

    if not np.isfinite(costs[n, m]):
        raise ValueError("No existe alineacion DTW valida.")

    path_length = int(lengths[n, m])

    return {
        "distance": round(float(costs[n, m] / path_length), 6),
        "path_length": path_length,
        "reference_frames": n,
        "candidate_frames": m,
    }
