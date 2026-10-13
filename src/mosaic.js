// Average every source pixel in each square. Scaling down with drawImage can
// sample colored text fringes instead of the mostly neutral document beneath.
export function averageBlocks({ data, width, height }, cell) {
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const result = new Uint8ClampedArray(columns * rows * 4);
  for (let row = 0; row < rows; row++) {
    const top = row * cell;
    const bottom = Math.min(top + cell, height);
    for (let column = 0; column < columns; column++) {
      const left = column * cell;
      const right = Math.min(left + cell, width);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let y = top; y < bottom; y++) {
        for (let offset = (y * width + left) * 4; offset < (y * width + right) * 4; offset += 4) {
          const opacity = data[offset + 3];
          red += data[offset] * opacity;
          green += data[offset + 1] * opacity;
          blue += data[offset + 2] * opacity;
          alpha += opacity;
        }
      }
      const target = (row * columns + column) * 4;
      if (alpha) {
        result[target] = Math.round(red / alpha);
        result[target + 1] = Math.round(green / alpha);
        result[target + 2] = Math.round(blue / alpha);
        result[target + 3] = Math.round(alpha / ((right - left) * (bottom - top)));
      }
    }
  }
  return { data: result, width: columns, height: rows };
}
