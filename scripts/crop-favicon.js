#!/usr/bin/env osascript -l JavaScript
// Crop kitty+laptop region out of src/assets/tabby-brand-lockup.png and write a
// square source PNG to icons/icon-source-kitty.png. From there `sips` resizes
// it down to 16/32/48/128 favicons. Placeholder pipeline — swap with a
// hand-tuned set from realfavicongenerator.net for the polished version.

ObjC.import('Foundation');
ObjC.import('AppKit');

function run() {
  const cwd = $.NSFileManager.defaultManager.currentDirectoryPath.js;
  const src = cwd + '/src/assets/tabby-brand-lockup.png';
  const dst = cwd + '/icons/icon-source-kitty.png';

  const url = $.NSURL.fileURLWithPath(src);
  const img = $.NSImage.alloc.initWithContentsOfURL(url);
  if (!img || !img.isValid) throw new Error('Could not load ' + src);

  const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
  const w = rep.pixelsWide;
  const h = rep.pixelsHigh;

  // Lockup is 1536x1024 with kitty+laptop in the left third. Square crop of
  // ~32% of the source width, sitting left of center so the wordmark is excluded.
  const cropW = Math.round(w * 0.275); // ~422 of 1536
  const cropH = cropW;
  const cropX = Math.round(w * 0.155); // left edge ~238
  const cropY = Math.round(h * 0.27); // top edge in image coords ~276; flipped below

  // Cocoa origin is bottom-left, so flip Y for the source rect.
  const srcRectY = h - cropY - cropH;

  const cropped = $.NSImage.alloc.initWithSize($.NSMakeSize(cropW, cropH));
  cropped.lockFocus;
  img.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, cropW, cropH),
    $.NSMakeRect(cropX, srcRectY, cropW, cropH),
    1, // NSCompositingOperationCopy
    1.0,
  );
  cropped.unlockFocus;

  const outRep = $.NSBitmapImageRep.imageRepWithData(cropped.TIFFRepresentation);
  const png = outRep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  png.writeToFileAtomically(dst, true);
  return 'wrote ' + dst + ' (' + cropW + 'x' + cropH + ')';
}
