import { mp4, webm } from './media';

export interface INoSleep {
  isEnabled: boolean;
  enable(): Promise<void>;
  disable(): void;
  dispose(): void;
}

class NoSleepSSR implements INoSleep {
  isEnabled = false;
  enable(): Promise<void> {
    throw new Error('NoSleep using SSR/no-op mode; do not call enable.');
  }
  disable() {
    throw new Error('NoSleep using SSR/no-op mode; do not call disable.');
  }
  dispose() {}
}

class NoSleepNative implements INoSleep {
  isEnabled = false;
  wakeLock?: WakeLockSentinel;

  constructor() {
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('fullscreenchange', this.handleVisibilityChange);
  }

  handleVisibilityChange() {
    this.wakeLock && document.visibilityState === 'visible' && this.enable();
  }

  async enable() {
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.isEnabled = true;
      console.debug('Wake Lock active.');
      this.wakeLock.addEventListener('release', () => {
        // TODO: Potentially emit an event for the page to observe since
        // Wake Lock releases happen when page visibility changes.
        // (https://web.dev/wakelock/#wake-lock-lifecycle)
        console.debug('Wake Lock released.');
      });
    } catch (err) {
      this.isEnabled = false;
      if (err instanceof Error) console.error(`${err.name}, ${err.message}`);
    }
  }

  disable() {
    this.wakeLock?.release();
    this.wakeLock = undefined;
    this.isEnabled = false;
  }

  dispose() {
    // Remove event listeners
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    document.removeEventListener(
      'fullscreenchange',
      this.handleVisibilityChange,
    );

    // Release the wake lock if it exists
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = undefined;
    }

    this.isEnabled = false;
  }
}

class NoSleepVideo implements INoSleep {
  isEnabled = false;
  noSleepVideo: HTMLVideoElement;
  onLogEvent?: LogEventCallback;

  constructor(options?: {
    videoTitle?: string;
    videoSourceType?: 'webm' | 'mp4';
    onLogEvent?: LogEventCallback;
  }) {
    // Set up no sleep video element
    this.noSleepVideo = document.createElement('video');
    this.onLogEvent = options?.onLogEvent;

    const videoTitle = options?.videoTitle || 'No Sleep';
    this.noSleepVideo.setAttribute('title', videoTitle);
    this.noSleepVideo.setAttribute('playsinline', '');

    if (options?.videoSourceType === 'webm' || !options?.videoSourceType) {
      this._addSourceToVideo(this.noSleepVideo, 'webm', webm);
    }

    if (options?.videoSourceType === 'mp4' || !options?.videoSourceType) {
      this._addSourceToVideo(this.noSleepVideo, 'mp4', mp4);
    }

    // For iOS >15 video needs to be on the document to work as a wake lock
    Object.assign(this.noSleepVideo.style, {
      position: 'absolute',
      left: '-100%',
      top: '-100%',
    });
    document.querySelector('body')?.append(this.noSleepVideo);

    this.handleLoadedMetadata = this.handleLoadedMetadata.bind(this);
    this.noSleepVideo.addEventListener(
      'loadedmetadata',
      this.handleLoadedMetadata,
    );

    this.handleError = this.handleError.bind(this);
    this.noSleepVideo.addEventListener('error', this.handleError);

    this.handlePause = this.handlePause.bind(this);
    this.noSleepVideo.addEventListener('pause', this.handlePause);

    this.handleEnded = this.handleEnded.bind(this);
    this.noSleepVideo.addEventListener('ended', this.handleEnded);
  }

  handleLoadedMetadata() {
    // Use a slow playback rate to stretch the video and mitigate failures from a busy app/device
    this.noSleepVideo.playbackRate = 0.1;

    this.noSleepVideo.addEventListener('timeupdate', () => {
      let currentTime = this.noSleepVideo.currentTime;
      let updatedTime;
      if (this.noSleepVideo.currentTime > 0.5) {
        updatedTime = this.noSleepVideo.currentTime = Math.random() * 0.5;
      }
      this.onLogEvent?.(
        `video timeupdate Current Time: ${currentTime}, Duration: ${
          this.noSleepVideo.duration
        }, Playing: ${!this.noSleepVideo.paused}, Playback Rate: ${
          this.noSleepVideo.playbackRate
        }`,
        'info',
        'video timeupdate',
        {
          currentTime,
          ...(updatedTime !== undefined ? { updatedTime } : {}),
          duration: this.noSleepVideo.duration,
          paused: this.noSleepVideo.paused,
          playbackRate: this.noSleepVideo.playbackRate,
        },
      );
    });
  }

  handleError(e: Event | string | MediaError) {
    console.error('video error', e);
    this.onLogEvent?.(`video error: ${e}`, 'error', 'video error');
    this.isEnabled = !this.noSleepVideo.paused;
  }

  handlePause() {
    this.onLogEvent?.('video pause', 'info', 'video pause');
    this.isEnabled = false;
  }

  handleEnded() {
    this.onLogEvent?.('video ended', 'warn', 'video ended');
    this.isEnabled = false;
  }

  _addSourceToVideo(
    element: HTMLVideoElement,
    type: 'webm' | 'mp4',
    dataURI: string,
  ) {
    const source = document.createElement('source');
    source.src = dataURI;
    source.type = `video/${type}`;
    element.appendChild(source);
  }

  async enable() {
    const playPromise = this.noSleepVideo.play();
    try {
      const res = await playPromise;
      this.isEnabled = true;
      return res;
    } catch (err) {
      this.isEnabled = false;
      if (err instanceof Error) console.error(`${err.name}, ${err.message}`);
    }
  }

  disable() {
    this.noSleepVideo.pause();
    this.isEnabled = false;
  }

  dispose() {
    // Remove event listeners
    this.noSleepVideo.removeEventListener(
      'loadedmetadata',
      this.handleLoadedMetadata,
    );
    this.noSleepVideo.removeEventListener('error', this.handleError);
    this.noSleepVideo.removeEventListener('pause', this.handlePause);
    this.noSleepVideo.removeEventListener('ended', this.handleEnded);

    // Remove the video element from the DOM
    document.body.removeChild(this.noSleepVideo);
  }
}

/**
 * Factory method to force creation of the video-based implementation of NoSleep.
 * Useful for simulating a browser/platform where video is used from another
 * browser where it is not.
 */
export const createNoSleepVideo = (options?: {
  videoTitle?: string;
  videoSourceType?: 'webm' | 'mp4';
  onLogEvent?: LogEventCallback;
}): INoSleep => new NoSleepVideo(options);

type LogEventCallback = (
  message: string,
  level: string,
  type: string,
  properties?: { [key: string]: string | number | boolean },
) => void;

// Detect native Wake Lock API support
const defaultExport: {
  new (options?: {
    videoTitle?: string;
    videoSourceType?: 'webm' | 'mp4';
    onLogEvent?: LogEventCallback;
  }): INoSleep;
} =
  typeof navigator === 'undefined'
    ? NoSleepSSR
    : // As of iOS 17.0.3, PWA mode does not support nativeWakeLock.
    // See <https://bugs.webkit.org/show_bug.cgi?id=254545>
    // @ts-expect-error: using non-standard standalone property
    'wakeLock' in navigator && !navigator.standalone
    ? NoSleepNative
    : NoSleepVideo;

export default defaultExport;
