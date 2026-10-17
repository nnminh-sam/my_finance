export const getHeatmapColor = (
  total: number,
  referenceMax: number,
  theme: 'light' | 'dark' = 'light',
) => {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(referenceMax) || referenceMax <= 0) return '';

  const intensity = Math.min(total / referenceMax, 1);
  const baseOpacity = theme === 'dark' ? 0.2 : 0.08;
  const maxOpacity = theme === 'dark' ? 0.6 : 0.4;
  const blue = theme === 'dark' ? '96, 165, 250' : '59, 130, 246';
  const opacity = baseOpacity + (maxOpacity - baseOpacity) * intensity;

  return `rgba(${blue}, ${opacity})`;
};
