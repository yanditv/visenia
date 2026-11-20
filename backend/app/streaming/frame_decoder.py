import struct

import cv2
import numpy as np


HEADER = struct.Struct("<QI")


class FrameError(ValueError):
    pass


def parse_frame(data: bytes, max_bytes: int):
    if len(data) < HEADER.size + 4 or len(data) > max_bytes + HEADER.size:
        raise FrameError("Tamaño de frame inválido.")
    timestamp_ms, sequence = HEADER.unpack_from(data)
    jpeg = data[HEADER.size:]
    if not jpeg.startswith(b"\xff\xd8") or not jpeg.endswith(b"\xff\xd9"):
        raise FrameError("Se requiere un JPEG válido.")
    return timestamp_ms, sequence, jpeg


def jpeg_dimensions(jpeg: bytes):
    """Read SOF dimensions before allocating a decoded image."""
    offset = 2
    while offset + 3 < len(jpeg):
        if jpeg[offset] != 0xFF:
            raise FrameError("Cabecera JPEG inválida.")
        marker = jpeg[offset + 1]
        offset += 2
        if marker == 0xD9 or marker == 0xDA:
            break
        if marker == 0xFF:
            offset -= 1
            continue
        if marker in range(0xD0, 0xD8) or marker == 0x01:
            continue
        if offset + 2 > len(jpeg):
            break
        length = int.from_bytes(jpeg[offset:offset + 2], "big")
        if length < 2 or offset + length > len(jpeg):
            raise FrameError("Cabecera JPEG inválida.")
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if length < 7:
                raise FrameError("Dimensiones JPEG inválidas.")
            return (int.from_bytes(jpeg[offset + 5:offset + 7], "big"),
                    int.from_bytes(jpeg[offset + 3:offset + 5], "big"))
        offset += length
    raise FrameError("JPEG sin dimensiones.")


def decode_jpeg(jpeg: bytes, max_width: int, max_height: int):
    declared_width, declared_height = jpeg_dimensions(jpeg)
    if declared_width > max_width or declared_height > max_height:
        raise FrameError("La resolución supera el límite permitido.")
    image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise FrameError("No se pudo decodificar el frame JPEG.")
    height, width = image.shape[:2]
    if width > max_width or height > max_height or (width, height) != (declared_width, declared_height):
        raise FrameError("La resolución supera el límite permitido.")
    return image

