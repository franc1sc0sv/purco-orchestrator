export type BluePalette = {
  faint: string;
  soft: string;
  mid: string;
  strong: string;
  deep: string;
};

export const readBluePalette = (): BluePalette => {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  return {
    faint: read("--blue-1"),
    soft: read("--blue-2"),
    mid: read("--blue-3"),
    strong: read("--blue-4"),
    deep: read("--blue-5"),
  };
};
