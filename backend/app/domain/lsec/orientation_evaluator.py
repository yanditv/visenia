import numpy as np


def calculate_orientation(hand, width, height):
    """
    Calcula dos vectores unitarios por fotograma:
    - Normal aproximada de la palma
    - Direccion longitudinal de la mano

    Salida: (frames, 6)
    """

    points = hand[:, [0, 5, 17], :].astype(np.float64).copy()

    # MediaPipe normaliza X por ancho e Y por alto.
    # Z tiene aproximadamente la escala de X.
    points *= np.array([width, height, width], dtype=np.float64)

    wrist = points[:, 0]
    index_base = points[:, 1]
    pinky_base = points[:, 2]

    v1 = index_base - wrist
    v2 = pinky_base - wrist

    normal = np.cross(v1, v2)

    direction = (index_base + pinky_base) / 2.0 - wrist

    normal_length = np.linalg.norm(normal, axis=1)

    direction_length = np.linalg.norm(direction, axis=1)

    v1_length = np.linalg.norm(v1, axis=1)
    v2_length = np.linalg.norm(v2, axis=1)

    with np.errstate(divide="ignore", invalid="ignore"):
        separation = normal_length / (v1_length * v2_length)

    valid = (
        np.isfinite(points).all(axis=(1, 2))
        & np.isfinite(separation)
        & (separation > 0.05)
        & (normal_length > 1e-5)
        & (direction_length > 1e-5)
    )

    features = np.full((len(hand), 6), np.nan, dtype=np.float32)

    features[valid, :3] = normal[valid] / normal_length[valid, None]

    features[valid, 3:] = direction[valid] / direction_length[valid, None]

    return features, valid
