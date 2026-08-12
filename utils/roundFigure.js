const roundFigure = (value) => {
  const numericValue = Number(value || 0);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.ceil(numericValue);
};

module.exports = roundFigure;
