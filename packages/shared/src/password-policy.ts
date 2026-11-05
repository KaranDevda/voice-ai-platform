/** What a new password must satisfy. Returns the problem in plain words, or null when it is fine. Length matters most; there are no silly character rules. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return "use at least 12 characters";
  if (password.length > 200) return "use at most 200 characters";
  const local = email?.split("@")[0]?.toLowerCase();
  if (email && (password.toLowerCase() === email.toLowerCase() || (local && local.length >= 4 && password.toLowerCase().includes(local)))) return "do not use your e-mail address in the password";
  if (/^(.)\1+$/.test(password)) return "use more than one repeated character";
  if (new Set(password).size < 5) return "use a wider mix of characters";
  return null;
}
