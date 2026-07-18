/**
 * Credentials and metadata for the tunnel proxy.
 * This is the single type consumers need to configure an Electron session
 * (proxy URL, credentials for Basic auth, certificate fingerprint for
 * pinning the self-signed TLS certificate).
 */
export interface ITunnelProxyInfo {
    /** Proxy URL for `session.setProxy()` (e.g. `https://127.0.0.1:PORT`). */
    url: string;
    host: string;
    port: number;
    /** Basic auth credentials for `Proxy-Authorization`. */
    credentials: {
        username: string;
        password: string;
    };
    /** SHA-256 fingerprint of the self-signed certificate (`sha256/<base64>`). */
    certFingerprint: string;
}
