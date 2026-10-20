const EDGE_GAP_PX = 8;


export function computeMiniMenuPosition({ anchorRect, rootRect, menuSize }) {
  const spaceBelowRow = rootRect.bottom - anchorRect.bottom;
  const spaceAboveRow = anchorRect.top - rootRect.top;
  const needsFlipUpward =
    spaceBelowRow < menuSize.height + EDGE_GAP_PX &&
    spaceAboveRow > spaceBelowRow;

  const topInViewport = needsFlipUpward
    ? anchorRect.top - menuSize.height
    : anchorRect.bottom;


  const leftInViewport = anchorRect.right - menuSize.width;

  return {
    left: clampToRoot(
      leftInViewport - rootRect.left,
      rootRect.width - menuSize.width
    ),
    top: clampToRoot(
      topInViewport - rootRect.top,
      rootRect.height - menuSize.height
    ),
  };
}


function clampToRoot(offset, maxOffsetBeforeGap) {
  const maxOffset = Math.max(EDGE_GAP_PX, maxOffsetBeforeGap - EDGE_GAP_PX);
  if (offset < EDGE_GAP_PX) return EDGE_GAP_PX;
  if (offset > maxOffset) return maxOffset;
  return offset;
}
