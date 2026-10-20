export function simNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(
    value,
  );
}
export function simTemperature(value: number) {
  return `${simNumber(value)}°C`;
}

export function simId(id: string) {
  return `A${String(parseInt(id.slice(-12), 16)).padStart(2, "0")}`;
}
