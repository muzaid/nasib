#!/usr/bin/env python3
"""Serve this folder to your phone, over HTTPS, so the camera works.

    python3 apps/web/serve.py

Browsers only hand out a camera on a secure origin. `localhost` counts;
`http://192.168.1.x` does not, which is exactly the address your phone
needs. So this serves over HTTPS with a certificate it generates itself.

Your phone will warn that the certificate is not trusted — it is right,
nobody signed it. Accept it for this address and the camera works. If you
would rather not, everything except the camera step works over plain HTTP:

    python3 -m http.server 8000 --directory apps/web

No dependencies beyond the standard library and `openssl`, which Windows,
macOS and most Linux installs already have.
"""

from __future__ import annotations

import http.server
import socket
import ssl
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CERT = HERE / ".dev-cert.pem"
PORT = 8443


def local_address() -> str:
    """The address the phone should open. Found by asking the routing
    table which interface would reach the internet — no packet is sent."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def ensure_certificate() -> bool:
    if CERT.exists():
        return True

    print("Generating a self-signed certificate for this machine…")
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(CERT), "-out", str(CERT), "-days", "365",
             "-subj", "/CN=nasib-dev"],
            check=True, capture_output=True,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError) as err:
        print(f"Could not make a certificate ({err.__class__.__name__}).", file=sys.stderr)
        print("Serving over plain HTTP instead — every screen works except the camera.",
              file=sys.stderr)
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self):
        # A demo that serves yesterday's JavaScript is a demo that wastes
        # an afternoon.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


def main() -> None:
    secure = ensure_certificate()
    port = PORT if secure else 8000
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)

    if secure:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(CERT)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    scheme = "https" if secure else "http"
    host = local_address()

    print()
    print(f"  On this machine:  {scheme}://localhost:{port}/")
    print(f"  On your phone:    {scheme}://{host}:{port}/")
    print()
    if secure:
        print("  The phone will warn about the certificate. That is expected —")
        print("  it is self-signed. Accept it and the camera will work.")
    print("  Ctrl-C to stop.")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
