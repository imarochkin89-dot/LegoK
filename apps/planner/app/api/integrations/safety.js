function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function safeEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Некорректный адрес webhook"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") throw new Error("Webhook должен использовать HTTPS");
  if (url.username || url.password) throw new Error("Не добавляйте логин или пароль в адрес webhook");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal" || hostname.includes(":") || isPrivateIpv4(hostname)) throw new Error("Локальные и служебные адреса запрещены");
  return url;
}
