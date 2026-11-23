import numpy as np

JOINTS = np.array(
    [
        [0, 1, 2],
        [1, 2, 3],
        [2, 3, 4],
        [0, 5, 6],
        [5, 6, 7],
        [6, 7, 8],
        [0, 9, 10],
        [9, 10, 11],
        [10, 11, 12],
        [0, 13, 14],
        [13, 14, 15],
        [14, 15, 16],
        [0, 17, 18],
        [17, 18, 19],
        [18, 19, 20],
    ]
)


def calculate_angles(hand, dimensions=2):
    points = hand[:, :, :dimensions]

    a = points[:, JOINTS[:, 0], :]
    b = points[:, JOINTS[:, 1], :]
    c = points[:, JOINTS[:, 2], :]

    u = a - b
    v = c - b

    norm_u = np.linalg.norm(u, axis=2)
    norm_v = np.linalg.norm(v, axis=2)

    denominator = norm_u * norm_v

    with np.errstate(divide="ignore", invalid="ignore"):
        cosine = np.sum(u * v, axis=2) / denominator
        angles = np.arccos(np.clip(cosine, -1.0, 1.0)) / np.pi

    valid = (
        np.isfinite(angles).all(axis=1) & (norm_u > 1e-5).all(axis=1) & (norm_v > 1e-5).all(axis=1)
    )

    return angles.astype(np.float32), valid
