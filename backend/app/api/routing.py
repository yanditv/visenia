"""Request limits and validation responses for landmark captures."""

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

MAX_BODY_BYTES = 10 * 1024 * 1024


class LandmarkRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded(request: Request):
            if request.method == "POST":
                if (
                    request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    != "application/json"
                ):
                    raise HTTPException(
                        415, detail="Solo se aceptan landmarks en application/json."
                    )
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY_BYTES:
                        raise HTTPException(413, detail="La captura supera 10 MiB.")
                    body.extend(chunk)

                original = request
                buffered = bytes(body)
                delivered = False

                async def receive():
                    nonlocal delivered
                    if delivered:
                        return await original.receive()
                    delivered = True
                    return {"type": "http.request", "body": buffered, "more_body": False}

                request = Request(request.scope, receive=receive)
            try:
                return await handler(request)
            except RequestValidationError as error:
                return JSONResponse(
                    status_code=422,
                    content={
                        "detail": [
                            {key: item[key] for key in ("loc", "msg", "type")}
                            for item in error.errors()
                        ],
                    },
                )

        return bounded
