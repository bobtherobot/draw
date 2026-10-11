export function cloneShape(shape) {
  return {
    ...shape,
    attrs: { ...shape.attrs },
    style: { ...shape.style },
  };
}

export function restoreShape(shape, snap) {
  if (shape.attrs != null && snap.attrs != null) Object.assign(shape.attrs, snap.attrs);
  if (shape.style != null && snap.style != null) Object.assign(shape.style, snap.style);
  for (const k of ['_text','_fontSize','_fontFamily','_textAlign','_boxWidth','_boxHeight',
                   '_scaleX','_scaleY','_rotation','_rotCx','_rotCy','_rotDisplay','_transform','_origin']) {
    if (k in snap) shape[k] = snap[k];
    else delete shape[k];
  }
}
