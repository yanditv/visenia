import math


def distance_score(distance, good, bad):
    if not (
        all(math.isfinite(v) for v in (distance, good, bad)) and 0 <= good < bad and distance >= 0
    ):
        raise ValueError("Distancia o umbrales invalidos.")

    if distance <= good:
        return 100.0

    if distance >= bad:
        return 0.0

    return round(100 * (bad - distance) / (bad - good), 2)
