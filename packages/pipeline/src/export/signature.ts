import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

/**
 * Signing an export, and being honest about what that proves.
 *
 * The manifest lists every file with its SHA-256, so a signature over the
 * manifest covers the whole archive transitively. Ed25519 from `node:crypto`
 * and nothing else: an export has to be verifiable in twenty years by somebody
 * with a laptop, which rules out any dependency that has to still exist.
 *
 * What it proves is narrower than it looks, and the verifier says so out loud.
 * A public key travelling inside the same folder as the files it vouches for
 * proves only internal consistency — anybody who alters the archive can re-sign
 * it with a key of their own and swap the public half. The signature becomes
 * evidence of origin only when the fingerprint is compared against one
 * published somewhere else. That comparison is the family's to make, so the
 * fingerprint is printed prominently rather than buried in the JSON.
 */
export interface ManifestSignature {
  algorithm: 'ed25519';
  /** SPKI PEM. Travels with the export so no lookup is needed to check it. */
  publicKey: string;
  /** SHA-256 of the public key, grouped for reading aloud down a telephone. */
  fingerprint: string;
  /** Base64, over the exact bytes of manifest.json. */
  signature: string;
  signedAt: string;
}

export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32).toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join('-');
}

/**
 * Returns null when no key is configured, and the caller records the export as
 * unsigned. Failing the export instead would mean a family could not get their
 * archive out because of a deployment setting, which is the wrong trade in a
 * product whose whole point is that leaving is easy.
 */
export function signManifest(
  manifestBytes: Buffer,
  privateKeyPem: string | undefined,
): ManifestSignature | null {
  if (!privateKeyPem) return null;

  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `EXPORT_SIGNING_PRIVATE_KEY must be an Ed25519 private key, not ${key.asymmetricKeyType}`,
    );
  }
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();

  return {
    algorithm: 'ed25519',
    publicKey,
    fingerprint: keyFingerprint(publicKey),
    // Ed25519 signs the message itself: no separate digest, hence null.
    signature: sign(null, manifestBytes, key).toString('base64'),
    signedAt: new Date().toISOString(),
  };
}
