const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";

export function generateSecurePassword(length = 24): string {
  const targetLength = Math.min(128, Math.max(12, Math.floor(length)));
  const output: string[] = [];
  const random = new Uint32Array(targetLength * 2);
  crypto.getRandomValues(random);
  for (let index = 0; index < targetLength; index += 1) {
    output.push(PASSWORD_ALPHABET[random[index] % PASSWORD_ALPHABET.length]);
  }
  return output.join("");
}

export type PasswordStrength = "weak" | "fair" | "strong" | "excellent";

export function getPasswordStrength(value: string): PasswordStrength {
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 20) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score <= 1) return "weak";
  if (score <= 2) return "fair";
  if (score <= 4) return "strong";
  return "excellent";
}
