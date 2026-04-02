import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Encrypter, Decrypter } from 'age-encryption';

/**
 * An age-encrypted on-disk vault that maps labels to secret values.
 *
 * Usage:
 *   const vault = new Vault('/path/to/vault.age', passphrase);
 *   await vault.load();
 *   vault.set('OPENAI_API_KEY', 'sk-...');
 *   await vault.save();
 */
export class Vault {
  private readonly filePath: string;
  private readonly passphrase: string;
  private secrets: Map<string, string> = new Map();

  constructor(filePath: string, passphrase: string) {
    this.filePath = filePath;
    this.passphrase = passphrase;
  }

  /**
   * Load and decrypt the vault from disk.
   * If the file does not exist, starts with an empty map.
   */
  async load(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      this.secrets = new Map();
      return;
    }

    try {
      const encrypted = fs.readFileSync(this.filePath);
      const d = new Decrypter();
      d.addPassphrase(this.passphrase);
      const plaintext = await d.decrypt(encrypted, 'text');
      const data: Record<string, string> = JSON.parse(plaintext);
      this.secrets = new Map(Object.entries(data));
    } catch {
      // Decrypt or parse failure — start fresh rather than crash.
      this.secrets = new Map();
    }
  }

  /**
   * Encrypt and write the vault to disk atomically (temp file + rename).
   */
  async save(): Promise<void> {
    const data: Record<string, string> = Object.fromEntries(this.secrets);
    const plaintext = JSON.stringify(data);

    const e = new Encrypter();
    e.setPassphrase(this.passphrase);
    const encrypted = await e.encrypt(plaintext);

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = path.join(
      os.tmpdir(),
      `vault-${process.pid}-${Date.now()}.tmp`,
    );
    try {
      fs.writeFileSync(tmpPath, encrypted);
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Clean up temp file on failure.
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors.
      }
      throw err;
    }
  }

  get(label: string): string | undefined {
    return this.secrets.get(label);
  }

  set(label: string, value: string): void {
    this.secrets.set(label, value);
  }

  delete(label: string): boolean {
    return this.secrets.delete(label);
  }

  list(): string[] {
    return [...this.secrets.keys()];
  }

  has(label: string): boolean {
    return this.secrets.has(label);
  }

  /** Returns all secret values (useful for building redaction patterns). */
  values(): string[] {
    return [...this.secrets.values()];
  }
}
