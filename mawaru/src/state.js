// Mutable app state shared by every module (ES module bindings can't be reassigned from outside).
export const state = {
  // timeline
  keyframes: [],         // [{ t, q, p, ease, bez?, devices?: { [uid]: pose } }]
  duration: 0,
  currentTime: 0,
  playing: true,
  viewDirty: false,      // camera/devices edited by hand and not yet saved as a keyframe
  selected: 0,           // selected keyframe (its incoming segment owns the easing control)
  // export
  exporting: false,      // the live render loop pauses while frames are being rendered
  // frame
  format: '16:9',
  // devices
  selDevice: 0,
};

export const $ = id => document.getElementById(id);
