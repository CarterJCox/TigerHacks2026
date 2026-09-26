// frame.js: Handles video frame rotation, drawing to canvas, and seeking.

export function rotatedSize(width, height, rotation) {
  if  (rotation === 90 || rotation === 270) {
    return {
      width: height,
      height: width,
    };
  } else {
    return {
      width: width,
      height: height,
    }
  }
}

/**
 * Draws the current video frame into a canvas of size (outW, outH), rotating
 * clockwise by `rotation` degrees (0, 90, 180, 270).
 */
export function drawVideoFrame(ctx, video, rotation, outW, outH) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rotation === 90) {
    ctx.translate(outW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(video, 0, 0, outH, outW);
  } else if (rotation === 180) {
    ctx.translate(outW, outH);
    ctx.rotate(Math.PI);
    ctx.drawImage(video, 0, 0, outW, outH);
  } else if (rotation === 270) {
    ctx.translate(0, outH);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(video, 0, 0, outH, outW);
  } else {
    ctx.drawImage(video, 0, 0, outW, outH);
  }
  ctx.restore();
}

export function seekVideo(video, time, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    // No reason to seek if close enough to current time (provided that video is ready)
    if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('The video stopped decoding while seeking.'));
    };
    timer = setTimeout(() => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('Seeking in the video timed out.'));
    }, timeoutMs);
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = time;
  });
}
