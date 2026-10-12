"""Arma, alinea y firma el APK (APK Signature Scheme v2) sin el SDK de Android.

    python sign_apk.py SALIDA.apk LLAVE.p12 CLAVE_P12 BASE.apk classes.dex www_dir

- BASE.apk: lo que produce `aapt2 link` (manifiesto + recursos compilados).
- Se agregan classes.dex y la app web en assets/www.
- resources.arsc va sin comprimir y alineado a 4 bytes (obligatorio en Android 11+).
- Firma v2 (Android 7+), descrita en
  https://source.android.com/docs/security/features/apksigning/v2
"""

import hashlib
import os
import struct
import sys
import zipfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

V2_BLOCK_ID = 0x7109871A
RSA_PKCS1_SHA256 = 0x0103
CHUNK = 1024 * 1024
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def lp(b):
    """uint32 little-endian de largo + bytes."""
    return struct.pack("<I", len(b)) + b


def build_zip(out_path, base_apk, dex_path, www_dir):
    entries = []
    with zipfile.ZipFile(base_apk) as base:
        for info in base.infolist():
            entries.append((info.filename, base.read(info.filename)))
    with open(dex_path, "rb") as f:
        entries.append(("classes.dex", f.read()))
    for root, _, files in sorted(os.walk(www_dir)):
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, www_dir).replace(os.sep, "/")
            with open(full, "rb") as f:
                entries.append(("assets/www/" + rel, f.read()))

    with zipfile.ZipFile(out_path, "w") as z:
        for name, data in entries:
            stored = name == "resources.arsc" or name.endswith(".png")
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            if stored:
                # Rellena el campo "extra" para que los datos queden alineados a 4 bytes.
                header_end = z.fp.tell() + 30 + len(name.encode("utf-8"))
                info.extra = b"\0" * ((4 - header_end % 4) % 4)
            z.writestr(info, data)


def find_eocd(data):
    pos = data.rfind(b"PK\x05\x06")
    if pos < 0:
        raise ValueError("no es un zip")
    cd_size, cd_offset = struct.unpack("<II", data[pos + 12:pos + 20])
    return pos, cd_offset, cd_size


def chunked_digest(sections):
    digests = []
    for sec in sections:
        for i in range(0, len(sec), CHUNK):
            chunk = sec[i:i + CHUNK]
            digests.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(chunk)) + chunk).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(digests)) + b"".join(digests)).digest()


def sign_v2(path, p12_path, p12_password):
    with open(p12_path, "rb") as f:
        key, cert, _ = pkcs12.load_key_and_certificates(f.read(), p12_password.encode())
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pub_der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    with open(path, "rb") as f:
        data = f.read()
    eocd_pos, cd_offset, cd_size = find_eocd(data)
    if cd_offset + cd_size != eocd_pos:
        raise ValueError("zip con datos extra entre el directorio central y el EOCD")
    contents, central, eocd = data[:cd_offset], data[cd_offset:eocd_pos], data[eocd_pos:]

    digest = chunked_digest([contents, central, eocd])

    signed_data = (
        lp(lp(struct.pack("<I", RSA_PKCS1_SHA256) + lp(digest)))  # digests
        + lp(lp(cert_der))                                         # certificates
        + lp(b"")                                                  # additional attributes
    )
    signature = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = lp(signed_data) + lp(lp(struct.pack("<I", RSA_PKCS1_SHA256) + lp(signature))) + lp(pub_der)
    v2_value = lp(lp(signer))

    pair = struct.pack("<Q", 4 + len(v2_value)) + struct.pack("<I", V2_BLOCK_ID) + v2_value
    block_size = len(pair) + 8 + 16
    block = struct.pack("<Q", block_size) + pair + struct.pack("<Q", block_size) + b"APK Sig Block 42"

    new_eocd = eocd[:16] + struct.pack("<I", cd_offset + len(block)) + eocd[20:]
    with open(path, "wb") as f:
        f.write(contents + block + central + new_eocd)


def main():
    out, p12, password, base_apk, dex, www = sys.argv[1:7]
    build_zip(out, base_apk, dex, www)
    sign_v2(out, p12, password)
    print("APK firmado:", out)


if __name__ == "__main__":
    main()
