export function capitalizeWord(word:string) {
  if (!word) return "";
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
