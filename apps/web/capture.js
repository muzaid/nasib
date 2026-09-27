// The camera step, in a browser.
//
// What this genuinely does, and what it does not, because the difference
// matters and it is easy to oversell:
//
//   * It opens the real front camera and runs the real challenge — a
//     randomised sequence that expires, so a video recorded beforehand
//     cannot satisfy an order issued afterwards.
//   * It measures **inter-frame variation** on a fixed cadence, which is
//     a real signal: it separates a moving scene from a frozen one. Be
//     precise about what that catches, though — a *frozen* feed or an
//     image pasted in front of the camera reads near zero, while a
//     printed photo held in a shaking hand does not. It is a floor, not
//     a liveness test, and the copy on screen says so.
//   * Where the browser provides the Shape Detection API it also reads
//     the face box, so "come closer" and "you are out of frame" are real
//     rather than guessed. Most browsers do not, and the code says so
//     rather than pretending.
//
// What it cannot do: decide whether this is the same person as the ID or
// as the profile photos. That is a face-embedding comparison and it
// belongs on the server, where the answer cannot be patched out by
// whoever is holding the phone. The native app has the same split.

const STEPS = {
  look_straight: 'انظر أمامك مباشرة',
  turn_left: 'أدر رأسك إلى اليسار',
  turn_right: 'أدر رأسك إلى اليمين',
  look_up: 'ارفع رأسك قليلاً',
  blink: 'أغمض عينيك',
  smile: 'ابتسم',
  speak_digits: 'اقرأ هذه الأرقام بصوت مسموع',
};

const MOVEMENT_STEPS = ['turn_left', 'turn_right', 'look_up', 'blink', 'smile'];

// Held for this long before a step counts — long enough that a face
// swinging past the target does not, short enough that nobody has to pose.
const HOLD_MS = 900;
const SESSION_MS = 90_000;

// Measured rather than guessed. Sampling every animation frame made this
// meaningless: sixteen milliseconds apart, even a moving scene barely
// changes, and the first version of this file sat on "point the camera at
// your face" forever because of it. On a 100ms cadence, Chrome's animated
// test pattern measures about 0.93 and a frozen frame measures exactly 0.
const SAMPLE_MS = 100;

// A feed with no change at all: covered lens, frozen stream, or a still
// image injected in place of a camera. Not "a photograph" in general —
// a print held in a human hand moves plenty.
const FROZEN = 0.05;

// How long a motionless feed is given before the attempt is ended. The
// coaching line blocks progress on its own, so without this the session
// simply sat there for the full ninety seconds — technically a refusal,
// but it reads as a hung screen, and a hung screen is what people
// screenshot and send to support.
const FROZEN_GIVE_UP_MS = 6000;

// A camera that opens but never delivers a frame. It happens — another
// tab holding the device, a virtual camera with nothing behind it, a
// permission granted to a stream that stalls. Without this the screen
// waits the full ninety seconds showing an instruction nobody can satisfy.
const NO_FRAMES_MS = 8000;
const TOO_STILL = 0.35;

export function issueChallenge(rng = Math.random) {
  const pool = [...MOVEMENT_STEPS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const steps = ['look_straight', ...pool.slice(0, 3)];

  let digits = null;
  if (rng() < 0.35) {
    steps.push('speak_digits');
    digits = Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join('');
  }
  return { steps, digits, issuedAt: Date.now() };
}

export function stepLabel(step) {
  return STEPS[step] ?? step;
}

const EASTERN = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export function arabicDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => EASTERN[Number(d)]);
}

/**
 * Runs the guided capture against a <video> element.
 *
 * Reports progress through callbacks rather than returning a promise
 * alone, because the screen has to show the current instruction, the hold
 * progress and the coaching line as they change.
 */
export class Capture {
  constructor({ video, canvas, challenge, onProgress, onStep, onDone }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.challenge = challenge;
    this.onProgress = onProgress ?? (() => {});
    this.onStep = onStep ?? (() => {});
    this.onDone = onDone ?? (() => {});

    this.index = 0;
    this.frames = [];
    this.previous = null;
    this.variations = [];
    this.heldSince = 0;
    this.lastSample = 0;
    this.frozenSince = 0;
    this.stopped = false;
    this.detector = null;
    this.stream = null;
    this.startedAt = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('no-camera-api');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;

    // Raced, not awaited. On a stream that delivers no frames — another
    // tab holding the camera, a virtual device with nothing behind it —
    // play() simply never resolves, and awaiting it means the loop below
    // never starts and the screen waits forever on an instruction. Start
    // the loop either way; the no-frames timeout inside it is what ends a
    // capture that is never going to happen.
    await Promise.race([
      this.video.play().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);

    // Available in very few browsers. Where it is there, the coaching is
    // real; where it is not, the capture still runs on motion alone.
    if ('FaceDetector' in window) {
      try {
        this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
      } catch { this.detector = null; }
    }

    this.startedAt = Date.now();
    this.loop();
    return { faceDetection: this.detector !== null };
  }

  stop() {
    this.stopped = true;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.video.srcObject = null;
  }

  get currentStep() {
    return this.challenge.steps[this.index] ?? null;
  }

  loop() {
    if (this.stopped) return;

    // The session dies on its own. A challenge with no deadline is one
    // that can be taken away and answered at leisure.
    if (Date.now() - this.startedAt > SESSION_MS) {
      this.stop();
      this.onDone({ verdict: 'retake', reason: 'expired' });
      return;
    }

    this.tick().finally(() => {
      if (!this.stopped) requestAnimationFrame(() => this.loop());
    });
  }

  async tick() {
    const { video, canvas, ctx } = this;

    if (!video.videoWidth) {
      if (Date.now() - this.startedAt > NO_FRAMES_MS) {
        this.stop();
        this.onDone({ verdict: 'retake', reason: 'no_frames' });
      }
      return;
    }

    // Fixed cadence. The statistic only means anything when the gap
    // between the two frames is a constant.
    const now = Date.now();
    const due = now - this.lastSample >= SAMPLE_MS;
    if (!due) return;
    this.lastSample = now;

    // Small on purpose: the frame difference is a whole-image statistic
    // and a 96-pixel-wide copy carries it just as well as a full frame,
    // for a fraction of the work on a phone.
    canvas.width = 96;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 96);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const variation = this.previous ? meanAbsoluteDifference(this.previous, frame) : null;
    this.previous = frame;
    if (variation !== null) {
      this.variations.push(variation);
      if (this.variations.length > 240) this.variations.shift();
    }

    let coaching = null;
    let ready = true;

    if (this.detector) {
      let faces = [];
      try { faces = await this.detector.detect(video); } catch { faces = []; }

      if (faces.length === 0) { coaching = 'لا نرى وجهك — اجعله داخل الدائرة'; ready = false; }
      else if (faces.length > 1) { coaching = 'يجب أن تكون وحدك في الصورة'; ready = false; }
      else {
        const box = faces[0].boundingBox;
        const fill = box.width / Math.min(video.videoWidth, video.videoHeight);
        if (fill < 0.2) { coaching = 'اقترب قليلاً من الكاميرا'; ready = false; }
        else if (fill > 0.9) { coaching = 'أبعد الهاتف قليلاً'; ready = false; }
      }
    } else if (variation !== null && variation < FROZEN) {
      // No face detector: a feed that is not changing at all means the
      // lens is covered, or what is in front of it is not a scene.
      if (!this.frozenSince) this.frozenSince = now;
      if (now - this.frozenSince > FROZEN_GIVE_UP_MS) {
        this.stop();
        this.onDone({ verdict: 'under_review', reason: 'frozen_feed', median: variation });
        return;
      }
      coaching = 'لا نرى صورة متغيّرة — تأكد أن الكاميرا غير مغطاة';
      ready = false;
    } else {
      this.frozenSince = 0;
    }

    if (!ready) {
      this.heldSince = 0;
      this.onProgress({ hold: 0, coaching });
      return;
    }

    if (!this.heldSince) this.heldSince = Date.now();
    const hold = Math.min(1, (Date.now() - this.heldSince) / HOLD_MS);
    this.onProgress({ hold, coaching: null });

    if (hold >= 1) this.record();
  }

  record() {
    const step = this.currentStep;
    if (!step) return;

    this.frames.push({
      step,
      captured_at_ms: Date.now() - this.startedAt,
      variation: this.variations.at(-1) ?? 0,
    });

    this.index += 1;
    this.heldSince = 0;
    this.onStep(this.index);

    if (this.index >= this.challenge.steps.length) {
      this.stop();
      this.onDone(this.verdict());
    }
  }

  /** Skips the spoken step, and only that one. Someone who cannot speak
   *  is not a suspect, and the payload simply carries no frame for it. */
  skip() {
    if (this.currentStep !== 'speak_digits') return;
    this.index += 1;
    this.heldSince = 0;
    this.onStep(this.index);
    if (this.index >= this.challenge.steps.length) {
      this.stop();
      this.onDone(this.verdict());
    }
  }

  verdict() {
    const seen = this.variations.length;
    const median = seen ? [...this.variations].sort((a, b) => a - b)[Math.floor(seen / 2)] : 0;

    // Review rather than rejection, for two reasons. An unusually still
    // person is a plausible false positive, and a woman refused by a
    // still camera does not come back. And this signal is a floor, not
    // proof: it catches a frozen or injected feed, not every photograph.
    if (seen > 20 && median < TOO_STILL) {
      return { verdict: 'under_review', reason: 'unnaturally_consistent', median };
    }

    // Everything else the browser cannot decide. Matching this face to an
    // ID is server work; saying otherwise here would be a lie with a
    // progress bar on it.
    return { verdict: 'matched', median, frames: this.frames };
  }
}

/** Mean absolute difference per channel, 0-255. Cheap and sufficient. */
function meanAbsoluteDifference(a, b) {
  const x = a.data;
  const y = b.data;
  if (x.length !== y.length) return 0;

  let total = 0;
  // Every fourth pixel, skipping alpha: enough samples for a stable mean
  // and four times less work on a phone that is also running the preview.
  for (let i = 0; i < x.length; i += 16) {
    total += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
  }
  return total / ((x.length / 16) * 3);
}

export const _internals = { meanAbsoluteDifference, TOO_STILL, FROZEN, FROZEN_GIVE_UP_MS, SAMPLE_MS, HOLD_MS };
