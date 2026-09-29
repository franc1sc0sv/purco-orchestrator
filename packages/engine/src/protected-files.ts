const PROTECTED = [
  /(^|[\s/'"=])\.env(\.(?!example\b|sample\b|template\b|test\b)[\w.-]+)?(?=$|[\s'"/;|&)])/,
  /\.pem\b/,
  /\bid_(rsa|ed25519)\b/,
  /(^|\/)secrets\//,
  /[^\s/]*credentials[^\s/]*\.(json|ya?ml|txt|ini)\b/i,
];

const INPUT_KEYS = ["file_path", "path", "notebook_path", "command", "pattern"];

export const touchesProtectedFile = (input: Record<string, unknown>): boolean =>
  INPUT_KEYS.some((key) => {
    const value = input?.[key];
    return (
      typeof value === "string" &&
      PROTECTED.some((pattern) => pattern.test(value))
    );
  });
